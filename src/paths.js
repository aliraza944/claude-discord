import os from 'node:os';
import path from 'node:path';

export function homeDir() {
  return process.env.CLAUDE_DISCORD_HOME || path.join(os.homedir(), '.claude-discord');
}

export function statePath() {
  return path.join(homeDir(), 'state.json');
}

export function configPath() {
  return path.join(homeDir(), 'config.json');
}

export function pidPath() {
  return path.join(homeDir(), 'daemon.pid');
}

export function logPath() {
  return path.join(homeDir(), 'daemon.log');
}
