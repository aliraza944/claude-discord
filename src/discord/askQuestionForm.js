import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { postToThread } from './threads.js';
import { initState, isComplete, answeredCount, pickOption, submitOtherModal } from './formState.js';

/**
 * Rendered as a Components V2 message (`MessageFlags.IsComponentsV2`) so
 * each question's own text can sit directly above its own button row,
 * rather than every question's text being stacked above every row — a
 * plain content string plus action rows can't interleave text between rows
 * like that. Discord hard-caps a message at 5 action rows. This form
 * renders one row per question (its option buttons plus an "Other" button)
 * and one row for Submit, so at most 4 questions fit — not 5: ticket 02's
 * "≤5 questions renderable per message" was an approximation that didn't
 * reserve a row for Submit. Any call exceeding this (or with an over-wide
 * single question, see MAX_OPTIONS_PER_QUESTION) skips the Discord form
 * entirely (story 18).
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

function questionHeading(question, index) {
  const suffix = question.multiSelect ? ' (multi-select)' : '';
  return `**${index + 1}. ${question.question}${suffix}**`;
}

function statusLine(questions, state, note) {
  const answered = `*(${answeredCount(state)}/${questions.length} answered)*`;
  return note ? `${answered}\n\n${note}` : answered;
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

function buildFormComponents(messageId, questions, state, disabled, note) {
  const components = [new TextDisplayBuilder().setContent('🙋 **Claude is asking you a question:**')];
  questions.forEach((q, i) => {
    components.push(new TextDisplayBuilder().setContent(questionHeading(q, i)));
    components.push(buildQuestionRow(messageId, i, q, state.answers[i], disabled));
  });
  components.push(new TextDisplayBuilder().setContent(statusLine(questions, state, note)));
  components.push(buildSubmitRow(messageId, questions, state, disabled));
  return components;
}

/**
 * @param {string} messageId
 * @param {object[]} questions
 * @param {object} state
 * @param {{ disabled?: boolean, note?: string }} [options]
 */
function renderMessage(messageId, questions, state, options = {}) {
  const { disabled = false, note } = options;
  return { content: '', flags: MessageFlags.IsComponentsV2, components: buildFormComponents(messageId, questions, state, disabled, note) };
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

/**
 * Edits `entry.message` to a disabled, noted state and drops it from the
 * active-forms registry. Idempotent. Delivers `null` to the caller waiting
 * on this form's answer (via `onDeliver`) — an expiry or a pause means no
 * answer came through Discord, so the caller should fall back to whatever
 * it does when a question goes unanswered here (e.g. defer to the tool's
 * normal local prompt).
 */
async function disableForm(messageId, note) {
  const entry = activeForms.get(messageId);
  if (!entry) return;
  clearTimeout(entry.timeoutHandle);
  activeForms.delete(messageId);

  await entry.message.edit(renderMessage(messageId, entry.questions, entry.state, { disabled: true, note })).catch(() => {});
  entry.onDeliver?.(null);
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
 * message directing the user to answer locally instead (story 18), and
 * never calls `deps.onDeliver` at all since no form was ever registered.
 * Returns the posted form message, or null when the over-budget guard fired.
 *
 * `deps.onDeliver`, when the form CAN be rendered, is called exactly once
 * with either the resolved answers object (on Submit — see `buildAnswers`)
 * or `null` (on inactivity timeout or `/pause`). The caller awaits that
 * callback to learn the outcome; it is not carried in this function's own
 * return value, since the message posts immediately but the answer arrives
 * later, asynchronously, from a Discord interaction.
 * @param {object} discordClient
 * @param {{ threadId: string, questions: object[] }} params
 * @param {{ formTimeoutMs?: number, onDeliver?: (answers: object|null) => void }} [deps]
 */
export async function postAskUserQuestionForm(discordClient, { threadId, questions }, deps = {}) {
  if (exceedsFormBudget(questions)) {
    await postToThread(discordClient, threadId, OVER_BUDGET_MESSAGE);
    return null;
  }

  const state = initState(questions);
  // custom_ids embed the message's own id, so it must be posted once (with
  // placeholder content) before the real form — which needs that id — can
  // be built and swapped in via edit.
  const message = await postToThread(discordClient, threadId, '🙋 Claude is asking you a question…');
  await message.edit(renderMessage(message.id, questions, state));

  const entry = { messageId: message.id, message, questions, state, timeoutHandle: null, onDeliver: deps.onDeliver };
  activeForms.set(message.id, entry);
  resetTimeout(entry, deps.formTimeoutMs);

  return message;
}

async function handleOptionPick(interaction, entry, qIndex, optIndex, deps) {
  entry.state = pickOption(entry.state, qIndex, optIndex);
  resetTimeout(entry, deps.formTimeoutMs);
  await interaction.update(renderMessage(entry.messageId, entry.questions, entry.state));
}

async function handleOtherButton(interaction, entry, qIndex) {
  await interaction.showModal(otherModal(entry.messageId, qIndex, entry.questions[qIndex]));
}

async function handleOtherModalSubmit(interaction, entry, qIndex, deps) {
  const text = interaction.fields.getTextInputValue('other-text');
  entry.state = submitOtherModal(entry.state, qIndex, text);
  resetTimeout(entry, deps.formTimeoutMs);
  await interaction.update(renderMessage(entry.messageId, entry.questions, entry.state));
}

/** One resolved answer's value, in the shape Claude Code's AskUserQuestion tool expects: a label string, or an array of labels for a multi-select. */
function answerValue(question, answer) {
  if (answer.type === 'other') return answer.text;
  const labels = answer.indexes.map((i) => question.options[i].label);
  return question.multiSelect ? labels : labels[0];
}

/** Maps a complete form's state to `{ [question text]: answer }`, the shape AskUserQuestion's tool input expects back. */
function buildAnswers(questions, answers) {
  const result = {};
  questions.forEach((q, i) => {
    result[q.question] = answerValue(q, answers[i]);
  });
  return result;
}

async function handleSubmit(interaction, entry) {
  if (!isComplete(entry.state)) return; // defensive: the button should already be disabled otherwise

  clearTimeout(entry.timeoutHandle);
  activeForms.delete(entry.messageId);
  await interaction.deferUpdate();

  const { questions, state, messageId, message, onDeliver } = entry;
  const answers = buildAnswers(questions, state.answers);

  await message.edit(renderMessage(messageId, questions, state, { disabled: true, note: '✅ **Submitted.**' })).catch(() => {});
  onDeliver?.(answers);
}

/**
 * Wires InteractionCreate (buttons + the "Other" modal) so a form posted by
 * `postAskUserQuestionForm` can actually be answered and submitted. A tap
 * only ever affects the form identified by the message id embedded in its
 * own `custom_id`, so one session's form can never resolve another's.
 * @param {object} discordClient
 * @param {{ formTimeoutMs?: number }} [deps]
 */
export function registerAskQuestionFormHandlers(discordClient, deps = {}) {
  discordClient.on('interactionCreate', async (interaction) => {
    if (interaction.isButton?.() && interaction.customId?.startsWith('askq:')) {
      const [, messageId, kind, a, b] = interaction.customId.split(':');
      const entry = activeForms.get(messageId);
      if (!entry) return;

      if (kind === 'submit') await handleSubmit(interaction, entry);
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
