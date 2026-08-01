import { describe, it, expect, afterEach } from 'vitest';
import { createFakeDiscordClient, componentText } from './support/fakeDiscordClient.js';
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

// Layout for N questions: [header TextDisplay, (question TextDisplay, question
// ActionRow) * N, status TextDisplay, submit ActionRow] — see
// askQuestionForm.js's buildFormComponents. For a single-question form the
// question's own ActionRow is always at index 2, and the Submit row at index 4.
const SINGLE_Q_ROW_INDEX = 2;
const SINGLE_Q_SUBMIT_INDEX = 4;

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

    const result = await postAskUserQuestionForm(discordClient, { threadId: thread.id, questions });

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

    const result = await postAskUserQuestionForm(discordClient, { threadId: thread.id, questions });

    expect(result).toBeNull();
    expect(thread.messages).toHaveLength(1);
  });

  it('never calls onDeliver for an over-budget question — no form was ever registered', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await makeThread(discordClient);
    const questions = Array.from({ length: MAX_QUESTIONS_PER_FORM + 1 }, (_, i) => ({ question: `Q${i}`, multiSelect: false, options: [{ label: 'A' }] }));
    const onDeliver = () => {
      throw new Error('should never be called');
    };

    await postAskUserQuestionForm(discordClient, { threadId: thread.id, questions }, { onDeliver });
  });
});

describe('discord/askQuestionForm.js rendering', () => {
  it("renders each question's own text immediately above its own button row, not all questions stacked above all rows", async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await makeThread(discordClient);

    const message = await postAskUserQuestionForm(discordClient, {
      threadId: thread.id,
      questions: [SINGLE_Q, MULTI_Q],
    });

    // [header, Q0 text, Q0 row, Q1 text, Q1 row, status, submit]
    expect(message.components).toHaveLength(7);
    const types = message.components.map((c) => c.toJSON().type);
    expect(types).toEqual([10, 10, 1, 10, 1, 10, 1]); // TextDisplay, TextDisplay, ActionRow, ...

    expect(message.components[1].toJSON().content).toContain(SINGLE_Q.question);
    const q0Row = message.components[2].toJSON();
    expect(q0Row.components.map((c) => c.label)).toEqual(['Red', 'Blue', 'Other']);

    expect(message.components[3].toJSON().content).toContain(MULTI_Q.question);
    const q1Row = message.components[4].toJSON();
    expect(q1Row.components.map((c) => c.label)).toEqual(['Banana', 'Apple', 'Other']);

    const submitRow = message.components[6].toJSON();
    expect(submitRow.components[0].disabled).toBe(true);
    expect(submitRow.components[0].label).toContain('0/2');
  });
});

describe('discord/askQuestionForm.js picking answers', () => {
  it('picking a single-select option updates the message in place and marks it selected', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { threadId: thread.id, questions: [SINGLE_Q] });

    const interaction = discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();

    const row0 = message.components[SINGLE_Q_ROW_INDEX].toJSON();
    expect(row0.components[1].label).toContain('✓');
    expect(interaction.updates).toHaveLength(1);
    expect(componentText(message)).toContain('1/1 answered');
  });

  it('picking a second single-select option replaces the first pick', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { threadId: thread.id, questions: [SINGLE_Q] });

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await flush();
    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();

    const row0 = message.components[SINGLE_Q_ROW_INDEX].toJSON();
    expect(row0.components[0].label).not.toContain('✓');
    expect(row0.components[1].label).toContain('✓');
  });

  it('multi-select toggles a pick on and back off', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { threadId: thread.id, questions: [MULTI_Q] });

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await flush();
    expect(componentText(message)).toContain('1/1 answered');

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await flush();
    expect(componentText(message)).toContain('0/1 answered');
  });

  it('the Other button opens a modal, and submitting it records the free-text answer on the original message', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    const message = await postAskUserQuestionForm(discordClient, { threadId: thread.id, questions: [SINGLE_Q] });

    const buttonInteraction = discordClient.simulateButtonClick(`askq:${message.id}:other:0`, { messageId: message.id });
    await flush();
    expect(buttonInteraction.shownModal).toBeTruthy();
    const modalCustomId = buttonInteraction.shownModal.data.custom_id;

    discordClient.simulateModalSubmit(modalCustomId, { 'other-text': 'Purple' });
    await flush();

    const row0 = message.components[SINGLE_Q_ROW_INDEX].toJSON();
    expect(row0.components[2].label).toContain('Purple');
    expect(componentText(message)).toContain('1/1 answered');
  });

  it('a tap on one form never resolves a different form', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const threadA = await makeThread(discordClient);
    const threadB = await makeThread(discordClient);
    const messageA = await postAskUserQuestionForm(discordClient, { threadId: threadA.id, questions: [SINGLE_Q] });
    const messageB = await postAskUserQuestionForm(discordClient, { threadId: threadB.id, questions: [SINGLE_Q] });

    discordClient.simulateButtonClick(`askq:${messageA.id}:opt:0:0`, { messageId: messageA.id });
    await flush();

    expect(componentText(messageA)).toContain('1/1 answered');
    expect(componentText(messageB)).toContain('0/1 answered');
  });
});

describe('discord/askQuestionForm.js submit', () => {
  it('delivers a single-select answer as a plain label string via onDeliver, and marks the message Submitted', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    let delivered;
    const message = await postAskUserQuestionForm(
      discordClient,
      { threadId: thread.id, questions: [SINGLE_Q] },
      { onDeliver: (answers) => (delivered = answers) }
    );

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();
    discordClient.simulateButtonClick(`askq:${message.id}:submit`, { messageId: message.id });
    await flush();

    expect(componentText(message)).toContain('Submitted');
    const submitRow = message.components[SINGLE_Q_SUBMIT_INDEX].toJSON();
    expect(submitRow.components[0].disabled).toBe(true);
    expect(delivered).toEqual({ [SINGLE_Q.question]: 'Blue' });
  });

  it('delivers a multi-select answer as an array of labels, and a free-text answer as its raw text', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    let delivered;
    const message = await postAskUserQuestionForm(
      discordClient,
      { threadId: thread.id, questions: [MULTI_Q, SINGLE_Q] },
      { onDeliver: (answers) => (delivered = answers) }
    );

    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await flush();
    discordClient.simulateButtonClick(`askq:${message.id}:opt:0:1`, { messageId: message.id });
    await flush();

    const otherInteraction = discordClient.simulateButtonClick(`askq:${message.id}:other:1`, { messageId: message.id });
    await flush();
    discordClient.simulateModalSubmit(otherInteraction.shownModal.data.custom_id, { 'other-text': 'Purple' });
    await flush();

    discordClient.simulateButtonClick(`askq:${message.id}:submit`, { messageId: message.id });
    await flush();

    expect(delivered).toEqual({
      [MULTI_Q.question]: ['Banana', 'Apple'],
      [SINGLE_Q.question]: 'Purple',
    });
  });

  it('clicking submit while incomplete is a no-op (defensive; the button should already be disabled)', async () => {
    const discordClient = createFakeDiscordClient();
    registerAskQuestionFormHandlers(discordClient);
    const thread = await makeThread(discordClient);
    let delivered = 'not called';
    const message = await postAskUserQuestionForm(
      discordClient,
      { threadId: thread.id, questions: [SINGLE_Q, MULTI_Q] },
      { onDeliver: (answers) => (delivered = answers) }
    );

    discordClient.simulateButtonClick(`askq:${message.id}:submit`, { messageId: message.id });
    await flush();

    expect(delivered).toBe('not called');
    expect(componentText(message)).not.toContain('Submitted');
  });
});

describe('discord/askQuestionForm.js expiry and pause', () => {
  it('disables an in-flight form after the inactivity timeout fires, and delivers null', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await makeThread(discordClient);
    let delivered = 'not called';
    const message = await postAskUserQuestionForm(
      discordClient,
      { threadId: thread.id, questions: [SINGLE_Q] },
      { formTimeoutMs: 20, onDeliver: (answers) => (delivered = answers) }
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(componentText(message)).toMatch(/expired/i);
    const row0 = message.components[SINGLE_Q_ROW_INDEX].toJSON();
    expect(row0.components.every((c) => c.disabled)).toBe(true);
    expect(delivered).toBeNull();
  });

  it('disableAllActiveForms disables every in-flight form immediately and delivers null to each, e.g. on /pause', async () => {
    const discordClient = createFakeDiscordClient();
    const threadA = await makeThread(discordClient);
    const threadB = await makeThread(discordClient);
    let deliveredA = 'not called';
    let deliveredB = 'not called';
    const messageA = await postAskUserQuestionForm(discordClient, { threadId: threadA.id, questions: [SINGLE_Q] }, { onDeliver: (a) => (deliveredA = a) });
    const messageB = await postAskUserQuestionForm(discordClient, { threadId: threadB.id, questions: [SINGLE_Q] }, { onDeliver: (a) => (deliveredB = a) });

    await disableAllActiveForms();

    expect(componentText(messageA)).toMatch(/paused/i);
    expect(componentText(messageB)).toMatch(/paused/i);
    expect(messageA.components[SINGLE_Q_ROW_INDEX].toJSON().components.every((c) => c.disabled)).toBe(true);
    expect(deliveredA).toBeNull();
    expect(deliveredB).toBeNull();

    // Idempotent — nothing left registered, so a second call is a harmless no-op.
    await expect(disableAllActiveForms()).resolves.toBeUndefined();
  });
});
