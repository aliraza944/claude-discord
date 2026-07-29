import { describe, it, expect } from 'vitest';
import { formatThreadName } from '../src/discord/threads.js';

describe('formatThreadName', () => {
  it('formats as "{projectName} — {YYYY-MM-DD HH:mm}" at minute precision', () => {
    const now = new Date(2026, 6, 29, 9, 5, 42);
    expect(formatThreadName('my-project', now)).toBe('my-project — 2026-07-29 09:05');
  });

  it('pads single-digit month, day, hour, and minute', () => {
    const now = new Date(2026, 0, 2, 3, 4, 0);
    expect(formatThreadName('p', now)).toBe('p — 2026-01-02 03:04');
  });

  it('produces distinct names for the same project at different minutes', () => {
    const first = formatThreadName('p', new Date(2026, 6, 29, 9, 5, 0));
    const second = formatThreadName('p', new Date(2026, 6, 29, 9, 6, 0));
    expect(first).not.toBe(second);
  });
});
