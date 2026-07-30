import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveHookBinPath, installHooks, mergeHooksBlock } from '../src/hooksInstall.js';
import { claudeSettingsPath } from '../src/paths.js';

let claudeHome;

beforeEach(() => {
  claudeHome = mkdtempSync(path.join(tmpdir(), 'claude-discord-settings-'));
  process.env.CLAUDE_DISCORD_CLAUDE_HOME = claudeHome;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_CLAUDE_HOME;
  rmSync(claudeHome, { recursive: true, force: true });
});

describe('resolveHookBinPath', () => {
  it('resolves to the real, on-disk claude-discord-hook bin', () => {
    const resolved = resolveHookBinPath();
    expect(resolved).toMatch(/claude-discord-hook\.js$/);
    // must actually exist on disk
    expect(() => readFileSync(resolved, 'utf8')).not.toThrow();
  });
});

describe('mergeHooksBlock', () => {
  it('installs PermissionRequest (.*), Notification, and SessionStart matchers', () => {
    const merged = mergeHooksBlock({}, '/abs/path/claude-discord-hook.js');

    expect(merged.PermissionRequest[0].matcher).toBe('.*');
    expect(merged.PermissionRequest[0].hooks[0].command).toContain('permission-request');
    expect(merged.PermissionRequest[0].hooks[0].timeout).toBe(21600);

    expect(merged.Notification[0].matcher).toBe('agent_needs_input|idle_prompt|agent_completed');
    expect(merged.Notification[0].hooks[0].command).toContain('notification');

    expect(merged.SessionStart[0].matcher).toBe('startup|resume|clear|compact');
    expect(merged.SessionStart[0].hooks[0].command).toContain('session-start');
  });

  it('preserves unrelated existing hooks for the same event', () => {
    const existing = {
      PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'some-other-tool' }] }],
    };
    const merged = mergeHooksBlock(existing, '/abs/path/claude-discord-hook.js');
    expect(merged.PermissionRequest).toHaveLength(2);
    expect(merged.PermissionRequest[0].hooks[0].command).toBe('some-other-tool');
  });

  it('is idempotent: re-running replaces the prior claude-discord-hook entry instead of duplicating it', () => {
    const first = mergeHooksBlock({}, '/abs/path/claude-discord-hook.js');
    const second = mergeHooksBlock(first, '/new/path/claude-discord-hook.js');
    expect(second.PermissionRequest).toHaveLength(1);
    expect(second.PermissionRequest[0].hooks[0].command).toContain('/new/path/claude-discord-hook.js');
  });
});

describe('installHooks', () => {
  it('writes the hooks block into a fresh ~/.claude/settings.json', () => {
    installHooks('/abs/path/claude-discord-hook.js');
    const settings = JSON.parse(readFileSync(claudeSettingsPath(), 'utf8'));
    expect(settings.hooks.PermissionRequest[0].matcher).toBe('.*');
  });

  it('preserves unrelated top-level settings keys', () => {
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(claudeSettingsPath(), JSON.stringify({ someOtherSetting: true, hooks: {} }));

    installHooks('/abs/path/claude-discord-hook.js');

    const settings = JSON.parse(readFileSync(claudeSettingsPath(), 'utf8'));
    expect(settings.someOtherSetting).toBe(true);
    expect(settings.hooks.SessionStart[0].matcher).toBe('startup|resume|clear|compact');
  });
});
