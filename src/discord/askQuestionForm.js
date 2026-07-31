import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { postToThread } from './threads.js';
import { initState, isComplete, answeredCount, pickOption, submitOtherModal } from './formState.js';
import { buildKeystrokePlan, parseReviewScreen, verifyReview } from './keystrokeMapper.js';
import { sendKey as sendKeyDefault, sendLiteral as sendLiteralDefault, capturePane as capturePaneDefault } from '../tmux.js';

/**
 * Discord hard-caps a message at 5 action rows. This form renders one row
 * per question (its option buttons plus an "Other" button) and one row for
 * Submit, so at most 4 questions fit — not 5: ticket 02's "≤5 questions
 * renderable per message" was an approximation that didn't reserve a row for
 * Submit. Any call exceeding this (or with an over-wide single question,
 * see MAX_OPTIONS_PER_QUESTION) skips the Discord form entirely (story 18).
 */
export const MAX_QUESTIONS_PER_FORM = 4;

/** Leaves room for a 5th "Other" button alongside up to 4 option buttons, within Discord's 5-buttons-per-row cap. */
export const MAX_OPTIONS_PER_QUESTION = 4;

export const DEFAULT_FORM_TIMEOUT_MS = 15 * 60 * 1000;

const OVER_BUDGET_MESSAGE =
  '🙋 Claude is asking a question that has too many questions/options to render as a Discord form. Please answer it locally in the terminal.';

/** In-memory Map<messageId, ActiveForm> of forms awaiting a Discord answer, keyed the same way pending.js keys permission requests. */
const activeForms = new Map();

function exceedsFormBudget(questions) {
  return questions.length > MAX_QUESTIONS_PER_FORM || questions.some((q) => q.options.length > MAX_OPTIONS_PER_QUESTION);
}

function formatHeader(questions, state) {
  const lines = ['🙋 **Claude is asking you a question:**', ''];
  questions.forEach((q, i) => {
    const suffix = q.multiSelect ? ' (multi-select)' : '';
    lines.push(`**${i + 1}. ${q.question}${suffix}**`);
  });
  lines.push('');
  lines.push(`*(${answeredCount(state)}/${questions.length} answered)*`);
  return lines.join('\n');
}

function optionButtonLabel(option, isPicked) {
  return (isPicked ? `✓ ${option.label}` : option.label).slice(0, 80);
}

function otherButtonLabel(answer) {
  return (answer?.type === 'other' ? `✓ Other: ${answer.text}` : 'Other').slice(0, 80);
}

function buildQuestionRow(messageId, qIndex, question, answer, disabled) {
  const row = new ActionRowBuilder();
  question.options.forEach((option, optIndex) => {
    const isPicked = answer?.type === 'options' && answer.indexes.includes(optIndex);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`askq:${messageId}:opt:${qIndex}:${optIndex}`)
        .setLabel(optionButtonLabel(option, isPicked))
        .setStyle(isPicked ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(disabled)
    );
  });
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`askq:${messageId}:other:${qIndex}`)
      .setLabel(otherButtonLabel(answer))
      .setStyle(answer?.type === 'other' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
  return row;
}

function buildSubmitRow(messageId, questions, state, disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`askq:${messageId}:submit`)
      .setLabel(`Submit (${answeredCount(state)}/${questions.length} answered)`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || !isComplete(state))
  );
}

function buildFormComponents(messageId, questions, state, disabled) {
  const rows = questions.map((q, i) => buildQuestionRow(messageId, i, q, state.answers[i], disabled));
  rows.push(buildSubmitRow(messageId, questions, state, disabled));
  return rows;
}

/**
 * @param {string} messageId
 * @param {object[]} questions
 * @param {object} state
 * @param {{ disabled?: boolean, note?: string }} [options]
 */
function renderMessage(messageId, questions, state, options = {}) {
  const { disabled = false, note } = options;
  const content = note ? `${formatHeader(questions, state)}\n\n${note}` : formatHeader(questions, state);
  return { content, components: buildFormComponents(messageId, questions, state, disabled) };
}

function otherModal(messageId, qIndex, question) {
  const modal = new ModalBuilder().setCustomId(`askq-other:${messageId}:${qIndex}`).setTitle(question.question.slice(0, 45));
  const input = new TextInputBuilder().setCustomId('other-text').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(400);
  modal.addLabelComponents(new LabelBuilder().setLabel('Your answer').setTextInputComponent(input));
  return modal;
}

function resetTimeout(entry, formTimeoutMs = DEFAULT_FORM_TIMEOUT_MS) {
  clearTimeout(entry.timeoutHandle);
  entry.timeoutHandle = setTimeout(() => {
    disableForm(entry.messageId, '⏱️ **This form expired from inactivity.** Please answer this question locally in the terminal.');
  }, formTimeoutMs);
}

/** Edits `entry.message` to a disabled, noted state and drops it from the active-forms registry. Idempotent. */
async function disableForm(messageId, note) {
  const entry = activeForms.get(messageId);
  if (!entry) return;
  clearTimeout(entry.timeoutHandle);
  activeForms.delete(messageId);

  const { content, components } = renderMessage(messageId, entry.questions, entry.state, { disabled: true, note });
  await entry.message.edit({ content, components }).catch(() => {});
}

/**
 * Disables every currently in-flight form (same treatment as an inactivity
 * expiry) — called when `/pause` toggles on, so a partially-answered form
 * doesn't sit there looking answerable once Discord control is paused.
 */
export async function disableAllActiveForms(note = '⏸️ **Discord control was paused.** Please answer this question locally in the terminal.') {
  await Promise.all([...activeForms.keys()].map((messageId) => disableForm(messageId, note)));
}

/**
 * Renders an `AskUserQuestion` call as a Discord form message, or — if it
 * has more questions/options than can be represented (see
 * MAX_QUESTIONS_PER_FORM/MAX_OPTIONS_PER_QUESTION) — posts a plain thread
 * message directing the user to answer locally instead (story 18). Returns
 * the posted form message, or null when the over-budget guard fired.
 * @param {object} discordClient
 * @param {{ session: { threadId: string, tmuxTarget: string }, questions: object[] }} params
 * @param {{ formTimeoutMs?: number }} [deps]
 */
export async function postAskUserQuestionForm(discordClient, { session, questions }, deps = {}) {
  if (exceedsFormBudget(questions)) {
    await postToThread(discordClient, session.threadId, OVER_BUDGET_MESSAGE);
    return null;
  }

  const state = initState(questions);
  const message = await postToThread(discordClient, session.threadId, formatHeader(questions, state));
  const { components } = renderMessage(message.id, questions, state);
  await message.edit({ content: message.content, components });

  const entry = { messageId: message.id, message, questions, state, session, timeoutHandle: null };
  activeForms.set(message.id, entry);
  resetTimeout(entry, deps.formTimeoutMs);

  return message;
}

async function handleOptionPick(interaction, entry, qIndex, optIndex, deps) {
  entry.state = pickOption(entry.state, qIndex, optIndex);
  resetTimeout(entry, deps.formTimeoutMs);
  const { content, components } = renderMessage(entry.messageId, entry.questions, entry.state);
  await interaction.update({ content, components });
}

async function handleOtherButton(interaction, entry, qIndex) {
  await interaction.showModal(otherModal(entry.messageId, qIndex, entry.questions[qIndex]));
}

async function handleOtherModalSubmit(interaction, entry, qIndex, deps) {
  const text = interaction.fields.getTextInputValue('other-text');
  entry.state = submitOtherModal(entry.state, qIndex, text);
  resetTimeout(entry, deps.formTimeoutMs);
  const { content, components } = renderMessage(entry.messageId, entry.questions, entry.state);
  await interaction.update({ content, components });
}

/**
 * Executes every op up to (not including) the final Review-screen commit
 * Enter, so the pane can be captured and verified before that last,
 * irreversible keystroke is ever sent.
 */
async function runNavigationOps(ops, target, tmuxDeps) {
  for (const op of ops) {
    if ('text' in op) await tmuxDeps.sendLiteral(target, op.text);
    else if ('number' in op) await tmuxDeps.sendLiteral(target, String(op.number));
    else await tmuxDeps.sendKey(target, op.key);
  }
}

async function handleSubmit(discordClient, interaction, entry, tmuxDeps) {
  if (!isComplete(entry.state)) return; // defensive: the button should already be disabled otherwise

  clearTimeout(entry.timeoutHandle);
  activeForms.delete(entry.messageId);
  await interaction.deferUpdate();

  const { questions, state, session, messageId, message } = entry;

  try {
    const plan = buildKeystrokePlan(questions, state.answers);
    const commitOp = plan[plan.length - 1];
    await runNavigationOps(plan.slice(0, -1), session.tmuxTarget, tmuxDeps);

    const paneText = await tmuxDeps.capturePane(session.tmuxTarget);
    const reviewEntries = parseReviewScreen(paneText);
    const verification = verifyReview(reviewEntries, questions, state.answers);

    if (!verification.ok) {
      const { content, components } = renderMessage(messageId, questions, state, {
        disabled: true,
        note: '❌ **Delivery failed — see below.**',
      });
      await message.edit({ content, components });
      await postToThread(
        discordClient,
        session.threadId,
        "⚠️ The terminal's review screen didn't match your answers, so nothing was submitted. The terminal prompt was left where the keystrokes stopped — please finish answering this question locally."
      );
      return;
    }

    await tmuxDeps.sendKey(session.tmuxTarget, commitOp.key);

    const { content, components } = renderMessage(messageId, questions, state, { disabled: true, note: '✅ **Submitted.**' });
    await message.edit({ content, components });
  } catch (err) {
    const { content, components } = renderMessage(messageId, questions, state, {
      disabled: true,
      note: '❌ **Delivery failed — see below.**',
    });
    await message.edit({ content, components }).catch(() => {});
    await postToThread(
      discordClient,
      session.threadId,
      `⚠️ Delivering your answers failed (${err.message}). The terminal prompt was left where the keystrokes stopped — please finish answering this question locally.`
    ).catch(() => {});
  }
}

/**
 * Wires InteractionCreate (buttons + the "Other" modal) so a form posted by
 * `postAskUserQuestionForm` can actually be answered and submitted. A tap
 * only ever affects the form identified by the message id embedded in its
 * own `custom_id`, so one session's form can never resolve another's.
 * @param {object} discordClient
 * @param {{ formTimeoutMs?: number, sendKey?: typeof sendKeyDefault, sendLiteral?: typeof sendLiteralDefault, capturePane?: typeof capturePaneDefault }} [deps]
 */
export function registerAskQuestionFormHandlers(discordClient, deps = {}) {
  const tmuxDeps = {
    sendKey: deps.sendKey ?? sendKeyDefault,
    sendLiteral: deps.sendLiteral ?? sendLiteralDefault,
    capturePane: deps.capturePane ?? capturePaneDefault,
  };

  discordClient.on('interactionCreate', async (interaction) => {
    if (interaction.isButton?.() && interaction.customId?.startsWith('askq:')) {
      const [, messageId, kind, a, b] = interaction.customId.split(':');
      const entry = activeForms.get(messageId);
      if (!entry) return;

      if (kind === 'submit') await handleSubmit(discordClient, interaction, entry, tmuxDeps);
      else if (kind === 'other') await handleOtherButton(interaction, entry, Number(a));
      else if (kind === 'opt') await handleOptionPick(interaction, entry, Number(a), Number(b), deps);
      return;
    }

    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('askq-other:')) {
      const [, messageId, qIndex] = interaction.customId.split(':');
      const entry = activeForms.get(messageId);
      if (!entry) return;
      await handleOtherModalSubmit(interaction, entry, Number(qIndex), deps);
    }
  });
}

/** Test-only: clears the registry so tests don't leak state across cases. */
export function resetAskQuestionForms() {
  for (const entry of activeForms.values()) clearTimeout(entry.timeoutHandle);
  activeForms.clear();
}
