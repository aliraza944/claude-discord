import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pidPath, logPath, homeDir } from '../paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, '../../bin/claude-discord.js');

export function readPid() {
  try {
    const raw = fs.readFileSync(pidPath(), 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function daemonStatus() {
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    return { running: true, pid };
  }
  return { running: false, pid: null };
}

export function startDaemonProcess() {
  const existing = daemonStatus();
  if (existing.running) {
    return { ...existing, alreadyRunning: true };
  }

  fs.mkdirSync(homeDir(), { recursive: true });
  const logFd = fs.openSync(logPath(), 'a');
  const child = spawn(process.execPath, [CLI_BIN, 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  fs.closeSync(logFd);
  fs.writeFileSync(pidPath(), String(child.pid));
  child.unref();
  return { running: true, pid: child.pid, alreadyRunning: false };
}

export function stopDaemonProcess() {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    try {
      fs.unlinkSync(pidPath());
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return { stopped: false };
  }
  process.kill(pid, 'SIGTERM');
  try {
    fs.unlinkSync(pidPath());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { stopped: true, pid };
}
