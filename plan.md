# claude-discord — Two-way Discord control for Claude Code sessions

## Context

The user runs Claude Code across multiple local projects and wants to keep working while away from their computer. Today, when a session needs tool permission or goes idle waiting for the next instruction, it just sits there until the user is physically back at the keyboard. The goal is a personal tool, `claude-discord`, that surfaces those moments in a Discord server (reachable from a phone) and lets the user actually act on them remotely — approve/deny permission requests, and send a new instruction to an idle session — with a simple global on/off switch for when they're at their desk and don't want Discord in the loop.

This was scoped through an extensive interview; the decisions below are settled requirements, not open options:

1. **Two-way control**, not just notifications.
2. **Discord layout**: one channel ("Claude Agents"), **one thread per session**, auto-created on session start — keeps concurrent sessions across different projects visually separated.
3. **Replies**: ✅/❌ **reactions** resolve permission prompts; **plain text** typed into a session's thread steers an idle session.
4. **Stack**: Node.js (v22.12.0 available) + discord.js.
5. **Sessions run inside tmux panes** (user already uses tmux) — this is what makes injecting a reply into an idle session possible, via `tmux send-keys`.
6. **Permission approvals** use Claude Code's `PermissionRequest` hook — it only fires when the permission system has already decided a prompt is needed, so auto-allowed tools never hit Discord. It's a blocking hook: Claude Code holds the tool call open until the hook returns a decision.
7. **Idle/steering** uses the `Notification` hook (fire-and-forget) to post "this session needs input" to Discord; the actual steering happens out-of-band via the bot's own `tmux send-keys`, not via any hook return value.
8. **Global on/off toggle only** (not per-project), flippable both from a local CLI command and from a Discord slash command — same underlying flag.
9. **Fail-safe**: if the local bot daemon is down, hooks must fail fast (~1-2s) and fall back to Claude Code's normal local prompt — never hang for hours because nobody's home.
10. **No extra token/API cost** — the daemon makes no Claude API calls; it's pure Discord + tmux + local IPC.

A design pass verified the exact hook JSON shapes against the current Claude Code hooks docs (not assumed) and surfaced two important corrections baked into the plan below: `PermissionRequest` only supports `decision.behavior` of `"allow"`/`"deny"` (deferring means printing *nothing*, not a third value), and Node's `http.Server` has a default 5-minute `requestTimeout` that must be disabled or a held-open permission request would get killed after 5 minutes regardless of the configured hook timeout.

## Project structure

New Node.js package at `/home/aliraza/projects/claude-discord` (currently empty, no git repo yet):

```
claude-discord/
├── package.json                 # "type":"module", bin: claude-discord, claude-discord-hook
├── bin/
│   ├── claude-discord.js        # CLI entrypoint (commander)
│   └── claude-discord-hook.js   # hook entrypoint, dispatches by argv[2]
├── src/
│   ├── config.js                 # ~/.claude-discord/config.json (token, guildId, channelId, port)
│   ├── state.js                  # ~/.claude-discord/state.json — atomic read/write (paused flag + session registry)
│   ├── tmux.js                   # newSession/sendText/hasSession/capturePane, execFile (no shell)
│   ├── httpClient.js             # fetch wrapper with per-call AbortSignal.timeout
│   ├── cli/commands/             # init, start, pause, resume, status, daemon (start/stop/status/logs/run)
│   ├── daemon/
│   │   ├── run.js                # boots HTTP server (requestTimeout=0) + discord.js client
│   │   ├── sessions.js           # session registry: register/attach/lookup
│   │   ├── pending.js            # in-memory Map<messageId, PendingPermissionRequest>
│   │   └── routes/                # register, session-start, permission-request, notification, control
│   ├── discord/
│   │   ├── client.js             # Client + required intents/partials
│   │   ├── threads.js            # createSessionThread, postToThread
│   │   ├── reactions.js          # MessageReactionAdd -> resolves pending permission request
│   │   ├── steering.js           # MessageCreate in a thread -> tmux.sendText()
│   │   └── slashCommands.js      # /pause /resume
│   └── hooks/
│       ├── permissionRequestHook.js
│       ├── notificationHook.js
│       └── sessionStartHook.js
```

## Key mechanics

**Local IPC**: short-lived hook scripts never talk to Discord directly — only to the long-running daemon over `localhost` HTTP (`src/httpClient.js`, `src/daemon/routes/*`). Config/state are plain JSON files under `~/.claude-discord/` (mirrors the existing `~/.claude/` convention) — no database, appropriate for a single-user tool.

**Permission flow** (`src/daemon/routes/permissionRequest.js`, `src/hooks/permissionRequestHook.js`):
- Hook does a fast liveness probe first (~1.5s timeout via `/health`). If the daemon isn't reachable, it exits 0 printing nothing — Claude Code falls through to its normal local Y/N prompt. This is the fail-fast requirement.
- If reachable, the hook POSTs the raw hook JSON to `/hook/permission-request` with **no timeout** on that call — the daemon holds the HTTP response open while it posts a message to the session's Discord thread, reacts ✅/❌ to it, and awaits either reaction.
- Daemon resolves: `allow`/`deny` → hook prints `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`; `defer` (paused, unregistered session, or safety-timeout) → hook prints nothing.
- `settings.json`'s hook `timeout` is set generously (e.g. `21600` = 6h) per the user's "Option A" choice; if Claude Code enforces a lower internal cap, it degrades safely to the normal local prompt — accepted, not engineered around.
- Node's default `server.requestTimeout`/`headersTimeout` (5 min) must be set to `0` in `daemon/run.js`, or a long-held response would get killed regardless of the hook's configured timeout.

**Idle/steering flow**: `Notification` hook (matchers `agent_needs_input`, `idle_prompt`, `agent_completed`) posts an FYI into the session's thread. A later plain-text reply in that thread (`src/discord/steering.js`) is delivered via `tmux send-keys` (argv-array `execFile`, never `shell:true`, since the text originates from Discord) into that session's registered tmux pane — not through any hook mechanism.

**Session identification**: `claude-discord start <path>` (`src/cli/commands/start.js`) generates a token, creates a uniquely-named tmux session, launches `claude` inside it with `CLAUDE_DISCORD_TOKEN=<token>` set inline (inherited by Claude Code and thus by its hook subprocesses), and registers `{token, projectName, cwd, tmuxTarget}` with the daemon (which creates the Discord thread immediately). The `SessionStart` hook reads that env var and reports it alongside Claude Code's real `session_id`, letting the daemon move the registration from "pending by token" to "active by session_id" — an exact match rather than a cwd-recency guess.

**On/off toggle**: single boolean in `state.json`. `claude-discord pause`/`resume` (CLI) and `/pause`/`/resume` (Discord slash commands) both call the same `setPaused(bool)` path — HTTP route if the daemon is up, direct file read-modify-write as a fallback if it's down. Every permission-request/notification hook call reads the flag fresh, so toggling takes effect immediately, no restart needed.

**Process lifecycle**: `claude-discord daemon start/stop/status/logs` manages a detached background Node process (pidfile at `~/.claude-discord/daemon.pid`, log at `daemon.log`). An optional `systemd --user` unit is documented in the README for auto-start on login — not auto-installed.

**settings.json**: hooks (`PermissionRequest` matcher `.*`, `Notification` matchers `agent_needs_input`/`idle_prompt`/`agent_completed`, `SessionStart` matchers `startup`/`resume`) are installed into the **user-level** `~/.claude/settings.json` via `claude-discord init` (which resolves the absolute path to the installed `claude-discord-hook` bin), since this must apply across every project, not just one.

**Discord bot requirements**: needs the **Message Content** privileged intent enabled in the Developer Portal (for reading steering replies) plus permission to create threads, send messages, and add reactions in the target channel. `claude-discord init` should call this out explicitly.

## Verification plan

1. `npm link` (or `npm install -g .`), create a Discord app/bot with Message Content intent enabled and invited to the server; `claude-discord init` (enter token/guild/channel, confirm it writes the hooks block into `~/.claude/settings.json`); `claude-discord daemon start`; `claude-discord status` shows `paused: false` and bot online.
2. **Permission approval**: `claude-discord start ~/some/test/project` → confirm a new thread appears; trigger a tool call needing permission → confirm the terminal doesn't prompt yet, a message with ✅/❌ appears in the thread, and tapping ✅ (then later ❌ on another call) actually allows/denies the tool call in the terminal session.
3. **Idle steering**: let a session go idle → confirm a "session needs input" message posts to its thread; reply with plain text from the thread → confirm the bot reacts 📨 and the text is actually typed into the session (verify via the attached terminal or `tmux capture-pane`).
4. **Global pause/resume**: `claude-discord pause` locally → trigger a permission call → confirm it falls back to the normal local terminal prompt, not Discord. `/resume` from Discord → confirm it goes back to Discord. Cross-check the opposite pairing too.
5. **Daemon-down fail-fast**: `claude-discord daemon stop` → trigger a permission call → confirm it falls through to the local prompt within ~1-2 seconds, not anywhere near the configured 6h timeout. Confirm `claude-discord pause` still works via direct state-file edit while the daemon is down.
6. **Multi-session isolation**: start two sessions against two different project directories concurrently → confirm two distinct threads, and that a reaction/reply in one thread only ever affects its own session's tmux pane.

## Critical files to implement first

- `src/daemon/routes/permissionRequest.js` — the core blocking allow/deny flow, depends on the `requestTimeout = 0` fix in `src/daemon/run.js`
- `src/hooks/permissionRequestHook.js` — two-phase fail-fast timeout logic
- `src/state.js` — atomic JSON state, single source of truth shared by CLI and daemon
- `src/cli/commands/start.js` — tmux session creation, token injection, daemon registration
- `src/tmux.js` — safe (argv-array, no shell) `send-keys` injection for steering replies
