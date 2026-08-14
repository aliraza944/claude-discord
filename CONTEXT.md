# claude-discord

Two-way Discord control for Claude Code sessions — a daemon bridges a Claude Code session to a Discord thread, relaying activity out and permission decisions/prompts back in.

## Language

**Live Feed**:
The read-only stream of messages posted to a session's Discord thread as Claude works, showing assistant text and tool calls as they happen.
_Avoid_: activity log, tool log, transcript feed

**Feed Watcher**:
The component that tails a session's transcript file and posts each qualifying entry to that session's Live Feed, in order, as it's written.
_Avoid_: transcript watcher, tail process

**Tool-Call Summary**:
The single-line representation of a tool call shown in the Live Feed — the tool's name plus its Key Argument, e.g. `Bash(npm test)`. Permanent: the Live Feed has no mechanism to reveal more than this line for a given tool call.
_Avoid_: tool call line, feed message, collapsed line

**Key Argument**:
The one value pulled out of a tool call's input to stand in for it in a Tool-Call Summary — a file path for Edit/Write, a command for Bash, or (for any tool without a dedicated rule, including every MCP tool) the first string-valued field found in the input.
_Avoid_: main arg, primary field

**Permission Request**:
A synchronous prompt posted to a session's thread asking the user to Allow or Deny a specific tool call before it runs. Shown with full detail (the same rendering used before the Live Feed existed) rather than a Tool-Call Summary, since the user needs that detail to decide.
_Avoid_: permission prompt, approval request
