/**
 * Comfortably under Discord's 2000-char message limit, leaving room for the
 * header/footer lines and code-block fencing around the preview itself.
 */
export const MAX_PREVIEW_LENGTH = 1200;

/** Truncates `text` to `MAX_PREVIEW_LENGTH`, appending an explicit "…truncated" marker if it was cut. */
export function truncate(text) {
  return text.length <= MAX_PREVIEW_LENGTH ? text : `${text.slice(0, MAX_PREVIEW_LENGTH)}\n…truncated`;
}

function describeBash(input) {
  const description = input.description ? `${input.description}\n` : '';
  return `${description}\`\`\`\n${truncate(String(input.command ?? ''))}\n\`\`\``;
}

function editDiff(edit) {
  return `- ${edit.old_string ?? ''}\n+ ${edit.new_string ?? ''}`;
}

function describeEdit(input) {
  return `**${input.file_path ?? 'unknown file'}**\n\`\`\`diff\n${truncate(editDiff(input))}\n\`\`\``;
}

function describeMultiEdit(input) {
  const diff = (input.edits ?? []).map(editDiff).join('\n\n');
  return `**${input.file_path ?? 'unknown file'}**\n\`\`\`diff\n${truncate(diff)}\n\`\`\``;
}

function describeWrite(input) {
  return `**${input.file_path ?? 'unknown file'}**\n\`\`\`\n${truncate(String(input.content ?? ''))}\n\`\`\``;
}

function describeGeneric(input) {
  return `\`\`\`json\n${truncate(JSON.stringify(input, null, 2))}\n\`\`\``;
}

const DESCRIBERS = {
  Bash: describeBash,
  Edit: describeEdit,
  MultiEdit: describeMultiEdit,
  Write: describeWrite,
};

/**
 * Renders a tool call's input the same way regardless of caller — the
 * permission-request route wraps this with its own "Permission requested"
 * header/footer, the feed watcher posts it as-is with a tool-name header.
 */
export function formatToolInput(toolName, input) {
  const describe = DESCRIBERS[toolName] ?? describeGeneric;
  return describe(input ?? {});
}

/** Max length of the key argument shown in a `summarizeToolCall` line. */
const MAX_ARG_LENGTH = 100;

function truncateArg(text) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= MAX_ARG_LENGTH ? oneLine : `${oneLine.slice(0, MAX_ARG_LENGTH)}…`;
}

function firstStringValue(input) {
  return Object.values(input).find((value) => typeof value === 'string') ?? null;
}

const KEY_ARG_EXTRACTORS = {
  Bash: (input) => input.command,
  Edit: (input) => input.file_path,
  MultiEdit: (input) => input.file_path,
  Write: (input) => input.file_path,
};

/**
 * One-line summary of a tool call, mirroring Claude Code CLI's own default
 * tool-call line (e.g. `Read(src/index.js)`): tool name plus a single
 * identifying argument. Tools without a dedicated extractor (including every
 * MCP tool) fall back to the first string-valued field in the input. Used by
 * the feed watcher, which shows only this line — unlike `formatToolInput`,
 * there's no way to reveal the full diff/content/JSON behind it.
 */
export function summarizeToolCall(toolName, input) {
  const safeInput = input ?? {};
  const extractor = KEY_ARG_EXTRACTORS[toolName];
  const keyArg = extractor ? extractor(safeInput) : firstStringValue(safeInput);
  if (typeof keyArg !== 'string' || keyArg.length === 0) return toolName;
  return `${toolName}(${truncateArg(keyArg)})`;
}
