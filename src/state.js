import fs from 'node:fs';
import { statePath, homeDir } from './paths.js';

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 2000;

function defaultState() {
  return { paused: false, sessions: {} };
}

function lockPath() {
  return `${statePath()}.lock`;
}

function ensureHomeDir() {
  fs.mkdirSync(homeDir(), { recursive: true });
}

async function acquireLock() {
  ensureHomeDir();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath(), 'wx'));
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for state lock at ${lockPath()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(lockPath());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export function readStateSync() {
  ensureHomeDir();
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return defaultState();
    throw err;
  }
}

function writeStateSync(state) {
  ensureHomeDir();
  const tmpPath = `${statePath()}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, statePath());
}

/**
 * Atomically read, modify, and persist state.js's on-disk state. `fn` receives
 * the current state and returns the next state (or mutates and returns it).
 * A lockfile serializes concurrent callers across processes (CLI + daemon).
 */
export async function modifyState(fn) {
  await acquireLock();
  try {
    const current = readStateSync();
    const next = (await fn(current)) ?? current;
    writeStateSync(next);
    return next;
  } finally {
    releaseLock();
  }
}

export async function setPaused(paused) {
  return modifyState((state) => ({ ...state, paused }));
}
