import { describe, it, expect, afterEach } from 'vitest';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { createTmuxSpy } from './support/tmuxSpy.js';
import {
  postAskUserQuestionForm,
  registerAskQuestionFormHandlers,
  disableAllActiveForms,
  resetAskQuestionForms,
  MAX_QUESTIONS_PER_FORM,
  MAX_OPTIONS_PER_QUESTION,
} from '../src/discord/askQuestionForm.js';

const SINGLE_Q = { question: 'What is your favorite color?', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] };
const MULTI_Q = { question: 'Which fruits do you like?', multiSelect: true, options: [{ label: 'Banana' }, { label: 'Apple' }] };

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function makeThread(discordClient) {
  const channel = await discordClient.channels.fetch('chan-1');
  return channel.threads.create({ name: 't' });
}

afterEach(() => {
  resetAskQuestionForms();
});

describe('discord/askQuestionForm.js over-budget guard', () => {
  it('skips the form and posts a plain message when there are more than MAX_QUESTIONS_PER_FORM questions', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await makeThread(discordClient);
    const questions = Array.from({ length: MAX_QUESTIONS_PER_FORM + 1 }, (_, i) => ({
      question: `Q${i}`,
      multiSelect: false,
      options: [{ label: 'A' }],
    }));

    const result = await postAskUserQuestionForm(discordClient, { session: { threadId: thread.id, tmuxTarget: 'tm' }, questions });

    expect(result).toBeNull();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].components).toEqual([]);
    expect(thread.messages[0].content).toMatch(/answer it locally/i);
  });

  it('skips the form when a single question has more than MAX_OPTIONS_PER_QUESTION options', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await makeThread(discordClient);
    const questions = [
      { question: 'Q', multiSelect: false, options: Array.from({ length: MAX_OPTIONS_PER_QUESTION + 1 }, (_, i) => ({ label: `O${i}` })) },
    ];

    const result = await postAskUserQuestionForm(discordClient, { session: { threadId: thread.id, tmuxTarget: 'tm' }, questions });

    expect(result).toBeNull();
    expect(thread.messages).toHaveLength(1);
  });
});

describe('discord/askQuestionForm.js rendering', () => {
  it('renders one row per question plus a Submit row, disabled until every question is answered', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await makeThread(discordClient);

    const message = await postAskUserQuestionForm(discordClient, {
      session: { threadId: thread.id, tmuxTarget: 'tm' },
      questions: [SINGLE_Q, MULTI_Q],
    });

    expect(message.components).toHaveLength(3);
    const submitRow = message.components[2].toJSON();
    expect(submitRow.components[0].disabled).toBe(true);
    expect(submitRow.components[0].label).toContain('0/2');
  });
});

describe('discord/askQuestionForm.js picking answers', () => {
  it('picking a single-select option updates the message in place and marks it selected', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { session: { threadId: thread.id, tmuxTarget: 'tm' }, questions: [SINGLE_Q] });

    const interaction = discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();

    const row0 = message.components[0].toJSON();
    expect(row0.components[1].label).toContain('✓');
    expect(interaction.updates).toHaveLength(1);
    expect(message.content).toContain('1/1 answered');
  });

  it('picking a second single-select option replaces the first pick', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { session: { threadId: thread.id, tmuxTarget: 'tm' }, questions: [SINGLE_Q] });

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await flush();
    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();

    const row0 = message.components[0].toJSON();
    expect(row0.components[0].label).not.toContain('✓');
    expect(row0.components[1].label).toContain('✓');
  });

  it('multi-select toggles a pick on and back off', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { session: { threadId: thread.id, tmuxTarget: 'tm' }, questions: [MULTI_Q] });

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await flush();
    expect(message.content).toContain('1/1 answered');

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await flush();
    expect(message.content).toContain('0/1 answered');
  });

  it('the Other button opens a modal, and submitting it records the free-text answer on the original message', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { session: { threadId: thread.id, tmuxTarget: 'tm' }, questions: [SINGLE_Q] });

    const buttonInteraction = discordClient.simulateButtonClick(`askq:${message.id}:other:0`, { messageId: message.id });
    await flush();
    expect(buttonInteraction.shownModal).toBeTruthy();
    const modalCustomId = buttonInteraction.shownModal.data.custom_id;

    discordClient.simulateModalSubmit(modalCustomId, { 'other-text': 'Purple' });
    await flush();

    const row0 = message.components[0].toJSON();
    expect(row0.components[2].label).toContain('Purple');
    expect(message.content).toContain('1/1 answered');
  });

  it('a tap on one form never resolves a different form', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const threadA = await makeThread(discordClient);
    const threadB = await makeThread(discordClient);
    const messageA = await postAskUserQuestionForm(discordClient, { session: { threadId: threadA.id, tmuxTarget: 'tm-a' }, questions: [SINGLE_Q] });
    const messageB = await postAskUserQuestionForm(discordClient, { session: { threadId: threadB.id, tmuxTarget: 'tm-b' }, questions: [SINGLE_Q] });

    discordClient.simulateButtonClick(`askq:${messageA.id}:opt:0:0`, { messageId: messageA.id });
    await flush();

    expect(messageA.content).toContain('1/1 answered');
    expect(messageB.content).toContain('0/1 answered');
  });
});

describe('discord/askQuestionForm.js submit', () => {
  it('executes the keystroke plan, verifies the review screen, and commits on a match', async () => {
    const discordClient = createFakeDiscordClient();
    const reviewScreen = ['Review your answers', '', ` ● ${SINGLE_Q.question}`, '   → Blue'].join('\n');
    const tmux = createTmuxSpy({ captures: [reviewScreen] });
    registerAskQuestionFormHandlers(discordClient, tmux);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, {
      session: { threadId: thread.id, tmuxTarget: 'tm-target' },
      questions: [SINGLE_Q],
    });

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();

    discordClient.simulateButtonClick(`askq:${message.id}:submit`, { messageId: message.id });
    await flush();
    await flush();
    await flush();

    expect(message.content).toContain('Submitted');
    const submitRow = message.components[1].toJSON();
    expect(submitRow.components[0].disabled).toBe(true);

    expect(tmux.calls.some((c) => c.type === 'literal' && c.text === '2' && c.target === 'tm-target')).toBe(true);
    expect(tmux.calls.filter((c) => c.type === 'key' && c.key === 'Enter')).toHaveLength(1);
    expect(thread.messages).toHaveLength(1); // no separate error message posted
  });

  it('aborts, disables the form, and posts an error when the review screen does not match — never sending the final commit key', async () => {
    const discordClient = createFakeDiscordClient();
    const wrongReviewScreen = ['Review your answers', '', ` ● ${SINGLE_Q.question}`, '   → Red'].join('\n');
    const tmux = createTmuxSpy({ captures: [wrongReviewScreen] });
    registerAskQuestionFormHandlers(discordClient, tmux);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, {
      session: { threadId: thread.id, tmuxTarget: 'tm-target' },
      questions: [SINGLE_Q],
    });

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();

    discordClient.simulateButtonClick(`askq:${message.id}:submit`, { messageId: message.id });
    await flush();
    await flush();
    await flush();

    expect(message.content).toContain('Delivery failed');
    const submitRow = message.components[1].toJSON();
    expect(submitRow.components[0].disabled).toBe(true);

    expect(tmux.calls.some((c) => c.type === 'key' && c.key === 'Enter')).toBe(false);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1].content).toMatch(/finish answering this question locally/i);
  });

  it('clicking submit while incomplete is a no-op (defensive; the button should already be disabled)', async () => {
    const discordClient = createFakeDiscordClient();
    const tmux = createTmuxSpy({ captures: [] });
    registerAskQuestionFormHandlers(discordClient, tmux);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, {
      session: { threadId: thread.id, tmuxTarget: 'tm' },
      questions: [SINGLE_Q, MULTI_Q],
    });

    discordClient.simulateButtonClick(`askq:${message.id}:submit`, { messageId: message.id });
    await flush();

    expect(tmux.calls).toHaveLength(0);
    expect(message.content).not.toContain('Submitted');
  });
});

describe('discord/askQuestionForm.js expiry and pause', () => {
  it('disables an in-flight form after the inactivity timeout fires', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(
      discordClient,
      { session: { threadId: thread.id, tmuxTarget: 'tm' }, questions: [SINGLE_Q] },
      { formTimeoutMs: 20 }
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(message.content).toMatch(/expired/i);
    const row0 = message.components[0].toJSON();
    expect(row0.components.every((c) => c.disabled)).toBe(true);
  });

  it('disableAllActiveForms disables every in-flight form immediately, e.g. on /pause', async () => {
    const discordClient = createFakeDiscordClient();
    const threadA = await makeThread(discordClient);
    const threadB = await makeThread(discordClient);
    const messageA = await postAskUserQuestionForm(discordClient, { session: { threadId: threadA.id, tmuxTarget: 'tm-a' }, questions: [SINGLE_Q] });
    const messageB = await postAskUserQuestionForm(discordClient, { session: { threadId: threadB.id, tmuxTarget: 'tm-b' }, questions: [SINGLE_Q] });

    await disableAllActiveForms();

    expect(messageA.content).toMatch(/paused/i);
    expect(messageB.content).toMatch(/paused/i);
    expect(messageA.components[0].toJSON().components.every((c) => c.disabled)).toBe(true);

    // Idempotent — nothing left registered, so a second call is a harmless no-op.
    await expect(disableAllActiveForms()).resolves.toBeUndefined();
  });
});
