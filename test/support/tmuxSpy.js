/**
 * A scripted stand-in for tmux.js's `sendKey`/`sendLiteral`/`capturePane`
 * (spec.md's "Seam 2" grown to serve canned capture-pane output), so the
 * submit handler's verify-then-commit path — including its abort-on-mismatch
 * behavior — can be driven entirely in-process, without a real tmux pane.
 * `captures` is a queue of strings `capturePane()` returns in order; each
 * call records what was sent/captured in `calls` for assertions.
 */
export function createTmuxSpy({ captures = [] } = {}) {
  const calls = [];
  const remainingCaptures = [...captures];

  return {
    calls,
    sendKey: async (target, key) => {
      calls.push({ type: 'key', target, key });
    },
    sendLiteral: async (target, text) => {
      calls.push({ type: 'literal', target, text });
    },
    capturePane: async (target) => {
      calls.push({ type: 'capture', target });
      if (remainingCaptures.length === 0) throw new Error('tmuxSpy: no scripted capturePane response left');
      return remainingCaptures.shift();
    },
  };
}
