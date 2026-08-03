/**
 * In-memory Set<string> per session of tool-call signatures approved via the
 * "Always Allow" button — mirrors Claude Code's own "don't ask again this
 * session" prompt option. A signature is `tool_name` + the tool's
 * *significant* input fields, so it only ever matches a call that does the
 * same thing (e.g. the same Bash command), never a broader pattern — the
 * safe default given there's no UI here to let the user pick a wider rule.
 * Cleared when the session is removed (see sessions.js's removeSession).
 */
const bySessionId = new Map();

/**
 * Fields that actually define what a tool call *does*, per tool name. Tools
 * not listed here sign on their whole raw input (safe default: nothing yet
 * carries a cosmetic-only field the way Bash does).
 *
 * Bash's `description` is a free-text label Claude Code regenerates fresh
 * per call (see toolCallFormat.js's describeBash, which already treats it as
 * cosmetic) — two calls with the identical `command` but different
 * `description` text are the same call, so `description` must be excluded
 * or "Always Allow" would silently stop matching on the very next repeat.
 */
const SIGNIFICANT_FIELDS = {
  Bash: ['command'],
};

function significantInput(toolName, toolInput) {
  const input = toolInput ?? {};
  const fields = SIGNIFICANT_FIELDS[toolName];
  if (!fields) return input;
  return Object.fromEntries(fields.map((field) => [field, input[field]]));
}

function signatureFor(toolName, toolInput) {
  return `${toolName}:${JSON.stringify(significantInput(toolName, toolInput))}`;
}

export function isAlwaysAllowed(sessionId, toolName, toolInput) {
  const signatures = bySessionId.get(sessionId);
  return signatures ? signatures.has(signatureFor(toolName, toolInput)) : false;
}

export function rememberAlwaysAllow(sessionId, toolName, toolInput) {
  let signatures = bySessionId.get(sessionId);
  if (!signatures) {
    signatures = new Set();
    bySessionId.set(sessionId, signatures);
  }
  signatures.add(signatureFor(toolName, toolInput));
}

export function clearAlwaysAllowed(sessionId) {
  bySessionId.delete(sessionId);
}

/** Test-only: clears every session's allowlist. */
export function resetAlwaysAllowed() {
  bySessionId.clear();
}
