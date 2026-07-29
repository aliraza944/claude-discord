import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readConfig, writeConfig } from '../../config.js';
import { configPath, claudeSettingsPath } from '../../paths.js';
import { resolveHookBinPath, installHooks } from '../../hooksInstall.js';

async function promptFor(rl, question, existingValue) {
  const suffix = existingValue ? ` [${existingValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || existingValue || '';
}

/**
 * @param {{ token?: string, guildId?: string, channelId?: string }} [options]
 *   Values supplied here skip the corresponding interactive prompt.
 */
export async function initCommand(options = {}) {
  const existing = readConfig();
  let token = options.token;
  let guildId = options.guildId;
  let channelId = options.channelId;

  if (!token || !guildId || !channelId) {
    const rl = readline.createInterface({ input, output });
    try {
      token = token || (await promptFor(rl, 'Discord bot token', existing.token));
      guildId = guildId || (await promptFor(rl, 'Discord guild (server) ID', existing.guildId));
      channelId = channelId || (await promptFor(rl, 'Discord channel ID', existing.channelId));
    } finally {
      rl.close();
    }
  }

  if (!token || !guildId || !channelId) {
    console.error('claude-discord init requires a bot token, guild ID, and channel ID.');
    process.exitCode = 1;
    return;
  }

  writeConfig({ ...existing, token, guildId, channelId });
  console.log(`\nConfig written to ${configPath()}`);

  const hookBinPath = resolveHookBinPath();
  installHooks(hookBinPath);
  console.log(`Hooks installed into ${claudeSettingsPath()}`);

  console.log(
    '\nBefore this will work, make sure your Discord bot has:\n' +
      '  - The "Message Content" privileged intent enabled (Developer Portal -> your app -> Bot -> Privileged Gateway Intents)\n' +
      '  - Permission to create threads, send messages, and add reactions in the target channel\n'
  );
}
