import { describe, it, expect, afterEach } from 'vitest';
import { createDaemonServer } from '../src/daemon/run.js';
import { createFakeDiscordClient, componentText } from './support/fakeDiscordClient.js';
import { postAskUserQuestionForm, resetAskQuestionForms } from '../src/discord/askQuestionForm.js';

afterEach(() => {
  resetAskQuestionForms();
});

// Regression test: registerAskQuestionFormHandlers must be wired into
// buildRoutes/createDaemonServer, not just callable in isolation — a form
// posted through the real daemon wiring must actually be answerable end to
// end. (Caught in review: postAskUserQuestionForm was called from
// feedWatcher.js, but nothing in src/daemon/run.js ever registered the
// InteractionCreate handler that resolves its button taps.)
describe('AskUserQuestion form wiring through createDaemonServer', () => {
  it('a button tap on a form posted through the real daemon server updates it in place', async () => {
    const discordClient = createFakeDiscordClient();
    createDaemonServer({ discordClient });

    const channel = await discordClient.channels.fetch('chan-1');
    const thread = await channel.threads.create({ name: 't' });
    const message = await postAskUserQuestionForm(discordClient, {
      threadId: thread.id,
      questions: [{ question: 'Pick one', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }],
    });

    const interaction = discordClient.simulateButtonClick(`askq:${message.id}:opt:0:0`, { messageId: message.id });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(interaction.updates).toHaveLength(1);
    expect(componentText(message)).toContain('1/1 answered');
  });
});
