import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeSettingsPath, claudeHomeDir } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const HOOK_BIN_PATH = path.join(PACKAGE_ROOT, 'bin', 'claude-discord-hook.js');

/** The absolute, symlink-resolved path to the installed claude-discord-hook bin. */
export function resolveHookBinPath() {
  return fs.realpathSync(HOOK_BIN_PATH);
}

function commandFor(hookBinPath, hookName) {
  return `"${hookBinPath}" ${hookName}`;
}

export function buildHooksBlock(hookBinPath) {
  return {
    PermissionRequest: [
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: commandFor(hookBinPath, 'permission-request'), timeout: 21600 }],
      },
    ],
    Notification: [
      {
        matcher: 'agent_needs_input|idle_prompt|agent_completed',
        hooks: [{ type: 'command', command: commandFor(hookBinPath, 'notification') }],
      },
    ],
    SessionStart: [
      {
        matcher: 'startup|resume|clear|compact',
        hooks: [{ type: 'command', command: commandFor(hookBinPath, 'session-start') }],
      },
    ],
  };
}

function isOurEntry(entry) {
  return entry?.hooks?.some(
    (h) => typeof h.command === 'string' && h.command.includes('claude-discord-hook')
  );
}

/**
 * Merges this tool's PermissionRequest/Notification/SessionStart hook
 * entries into an existing `hooks` block, replacing any prior
 * claude-discord-hook entries for those events (idempotent re-`init`) while
 * preserving everything else already configured for those events.
 */
export function mergeHooksBlock(existingHooks, hookBinPath) {
  const ours = buildHooksBlock(hookBinPath);
  const merged = { ...existingHooks };
  for (const [event, entries] of Object.entries(ours)) {
    const existingEntries = Array.isArray(merged[event]) ? merged[event] : [];
    merged[event] = [...existingEntries.filter((entry) => !isOurEntry(entry)), ...entries];
  }
  return merged;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(claudeSettingsPath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeSettings(settings) {
  fs.mkdirSync(claudeHomeDir(), { recursive: true });
  fs.writeFileSync(claudeSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

/** Installs (or refreshes) the required hooks into ~/.claude/settings.json. */
export function installHooks(hookBinPath) {
  const settings = readSettings();
  settings.hooks = mergeHooksBlock(settings.hooks ?? {}, hookBinPath);
  writeSettings(settings);
  return settings;
}
