# Spec: claude-discord — Two-way Discord control for Claude Code sessions

Status: ready-for-agent

## Problem Statement

The user runs Claude Code across multiple local projects, often inside tmux panes, and frequently steps away from their computer while sessions are running. Two things currently force them back to the keyboard:

1. A session hits a tool call that needs permission and just sits there waiting for a local Y/N prompt.
2. A session goes idle waiting for the next instruction, and there's no way to notice or respond to that except by being physically present.

There's no way today to see these moments or act on them remotely — the user either babysits the terminal or work simply stalls until they're back at their desk.

## Solution

`claude-discord` is a personal daemon + CLI that bridges Claude Code sessions running in tmux panes to a Discord server the user can reach from their phone. Each Claude Code session gets its own auto-created thread in a single "Claude Agents" channel. Permission prompts are posted to the session's thread and resolved by tapping ✅/❌ reactions; idle sessions post an FYI to their thread, and a plain-text reply in that thread is typed directly into the session's tmux pane to steer it. A single global on/off flag — toggleable from the local CLI or a Discord slash command — lets the user silence Discord entirely when they're at their desk. If the daemon isn't running, permission hooks fail fast and fall back to Claude Code's normal local prompt rather than hanging.

## User Stories

1. As a user, I want to run `claude-discord init` and be walked through entering my bot token, guild ID, and channel ID, so that I can configure the tool without hand-editing JSON.
2. As a user, I want `claude-discord init` to write the required hooks (`PermissionRequest`, `Notification`, `SessionStart`) into my user-level `~/.claude/settings.json`, so that every project I work in — not just one — gets Discord integration automatically.
3. As a user, I want `claude-discord init` to tell me explicitly that my Discord bot needs the Message Content privileged intent and thread/message/reaction permissions in the target channel, so that I don't discover a silent failure later.
4. As a user, I want to run `claude-discord start <path>` to launch Claude Code inside a new tmux session for a given project, so that the session is automatically wired up for Discord control.
5. As a user, I want a new Discord thread to be created automatically the moment I start a session, so that I have a dedicated place to watch and interact with that session from my phone.
6. As a user, I want the thread's name/topic to reflect the project so that when I have several sessions running concurrently, I can tell at a glance which thread belongs to which project.
7. As a user, when a tool call needs permission, I want the local terminal to NOT show its normal prompt while Discord is active, so that I'm not asked twice in two different places.
8. As a user, when a tool call needs permission, I want a message with ✅/❌ reactions posted to that session's thread, so that I can approve or deny it from my phone.
9. As a user, when I tap ✅ on a permission message, I want the underlying tool call to actually be allowed and the session to proceed, so that my remote approval has real effect.
10. As a user, when I tap ❌ on a permission message, I want the underlying tool call to actually be denied, so that I can block an action I don't want to happen without being at my desk.
11. As a user, I want auto-allowed tool calls (ones Claude Code's permission system wouldn't have prompted for anyway) to never generate a Discord message, so that my thread isn't flooded with noise.
12. As a user, when a session goes idle waiting for my input, I want a "this session needs input" message posted to its thread, so that I know it's waiting on me even when I'm away.
13. As a user, I want to reply with plain text in a session's thread and have that text actually typed into the corresponding tmux pane, so that I can steer an idle session from my phone.
14. As a user, I want some acknowledgement (e.g. a reaction on my reply) that my steering text was delivered, so that I know it was actually sent rather than silently lost.
15. As a user, I want a reaction or reply in one session's thread to only ever affect that session's own tmux pane, so that concurrent sessions across different projects never cross-talk.
16. As a user, I want a single global on/off switch (not per-project), so that I have one simple way to say "don't bother me on Discord right now."
17. As a user, I want to flip that switch locally via `claude-discord pause` / `claude-discord resume`, so that I can silence Discord from the terminal when I'm at my desk.
18. As a user, I want to flip that same switch from Discord via `/pause` and `/resume` slash commands, so that I can also silence or re-enable it remotely without needing terminal access.
19. As a user, when paused, I want permission prompts to fall back immediately to the normal local Y/N prompt instead of going to Discord, so that pausing has real, immediate effect.
20. As a user, I want toggling pause/resume to take effect immediately for any in-flight or future hook call, without needing to restart the daemon or any session, so that the switch is reliable.
21. As a user, when the daemon process is down or unreachable, I want a permission hook to detect that quickly (within ~1-2 seconds) and fall back to the normal local prompt, so that a dead daemon never causes an indefinite hang.
22. As a user, I want the fail-fast fallback to behave identically to Claude Code's default (no hook installed) behavior from the user's point of view, so that a daemon outage degrades gracefully rather than breaking my workflow.
23. As a user, I want `claude-discord pause`/`resume` to still work (by editing the state file directly) even when the daemon is down, so that I can always control the switch regardless of daemon health.
24. As a user, I want to run `claude-discord daemon start/stop/status/logs`, so that I can manage the background daemon process like any other local service.
25. As a user, I want `claude-discord status` to show me whether the daemon is running, whether it's paused, and whether the Discord bot is connected, so that I can quickly diagnose whether the system is working.
26. As a user, I want an optional `systemd --user` unit documented in the README, so that I can choose to auto-start the daemon on login without the tool forcing that on me.
27. As a user, I want config and state stored as plain JSON files under `~/.claude-discord/`, so that the tool is simple to inspect, back up, or hand-edit if something goes wrong.
28. As a user, I want the daemon to make zero calls to the Claude API, so that running this tool never adds token cost.
29. As a user, I want steering text that originates from Discord to be delivered into tmux via an argv-array `execFile` (never a shell), so that arbitrary text typed on my phone can never be interpreted as a shell command.
30. As a user, I want to run two sessions against two different project directories at the same time and have each show up as its own thread, so that I can multitask across projects.
31. As a user, when Claude Code's own hook timeout cap is lower than the configured 6h hook timeout, I want the system to degrade to the normal local prompt rather than error out, so that an internal platform limit doesn't produce a broken experience.
32. As a user, I want the `SessionStart` hook to reconcile a session's real Claude Code `session_id` with the token I generated at `start` time, so that permission/notification hooks fired later are attributed to the correct thread with certainty, not a cwd-recency guess.

## Implementation Decisions

**Modules to be built** (new Node.js ESM package, ships two bins: `claude-discord`, `claude-discord-hook`):

- `src/config.js` — reads/writes `~/.claude-discord/config.json` (`token`, `guildId`, `channelId`, `port`).
- `src/state.js` — atomic read/modify/write of `~/.claude-discord/state.json`, holding the `paused` boolean and the session registry (`token`/`session_id` → `{projectName, cwd, tmuxTarget, threadId}`). This is the single source of truth shared by both the CLI (direct file access) and the daemon (in-memory + persisted).
- `src/tmux.js` — thin wrapper over the real `tmux` binary: `newSession`, `sendText`, `hasSession`, `capturePane`. Always `execFile` with an argv array, never `shell: true`.
- `src/httpClient.js` — `fetch` wrapper that takes a per-call `AbortSignal.timeout`, used by hook scripts to talk to the daemon.
- `src/cli/commands/` — `init`, `start`, `pause`, `resume`, `status`, and `daemon` (`start`/`stop`/`status`/`logs`/`run`).
- `src/daemon/run.js` — boots an HTTP server with `requestTimeout` and `headersTimeout` explicitly set to `0` (Node's 5-minute default would otherwise kill a long-held permission request), plus the discord.js client.
- `src/daemon/sessions.js` — session registry: register (pending, by token), attach (promote to active, by `session_id`), lookup.
- `src/daemon/pending.js` — in-memory `Map<messageId, PendingPermissionRequest>` tracking permission requests awaiting a reaction.
- `src/daemon/routes/` — `register`, `session-start`, `permission-request`, `notification`, `control` (pause/resume over HTTP).
- `src/discord/client.js` — constructs the discord.js `Client` with the intents/partials the feature needs (guilds, guild messages, message content, message reactions).
- `src/discord/threads.js` — `createSessionThread`, `postToThread`.
- `src/discord/reactions.js` — `MessageReactionAdd` handler; resolves a pending permission request when ✅/❌ is added to its message.
- `src/discord/steering.js` — `MessageCreate` handler for messages inside a session thread; calls `tmux.sendText()`.
- `src/discord/slashCommands.js` — registers and handles `/pause` and `/resume`.
- `src/hooks/permissionRequestHook.js`, `src/hooks/notificationHook.js`, `src/hooks/sessionStartHook.js` — short-lived scripts invoked by Claude Code, dispatched from `bin/claude-discord-hook.js` by `argv[2]`.

**Permission flow (`PermissionRequest` hook, blocking):**
1. Hook does a fast liveness probe against `/health` with roughly a 1.5s timeout. Unreachable → hook exits 0 printing nothing, so Claude Code falls through to its normal local prompt.
2. If reachable, the hook POSTs the raw hook JSON to `/hook/permission-request` with no client-side timeout on that call — the daemon holds the response open.
3. Daemon posts a message with ✅/❌ reactions to the session's thread and awaits either reaction (or a safety timeout, or the global pause flag, or an unregistered session — any of which resolve as `defer`).
4. On `allow`/`deny`, hook prints `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`. `PermissionRequest` supports only these two `decision.behavior` values — there is no third "defer" value; deferring means printing nothing at all.
5. `settings.json`'s hook `timeout` is set generously (`21600`s / 6h). If Claude Code enforces a lower internal cap, the system accepts degrading to the local prompt rather than engineering around it.

**Idle/steering flow (`Notification` hook, fire-and-forget):** matchers `agent_needs_input`, `idle_prompt`, `agent_completed` post an FYI to the thread. The actual steering happens out-of-band: a later plain-text `MessageCreate` in that thread is delivered via `tmux send-keys` into the session's registered pane — not through any hook return value.

**Session identification:** `claude-discord start <path>` generates a token, creates a uniquely-named tmux session, launches `claude` with `CLAUDE_DISCORD_TOKEN=<token>` set inline (inherited by Claude Code and its hook subprocesses), and registers `{token, projectName, cwd, tmuxTarget}` with the daemon, which creates the thread immediately (pending-by-token). The `SessionStart` hook reports that token alongside Claude Code's real `session_id`, letting the daemon promote the registration to active-by-`session_id` — an exact match rather than a cwd-recency guess.

**On/off toggle:** single boolean in `state.json`. CLI (`pause`/`resume`) and Discord (`/pause`/`/resume`) both call the same `setPaused(bool)` path — HTTP route if the daemon is up, direct file read-modify-write fallback if it's down. Every hook call reads the flag fresh.

**Process lifecycle:** `claude-discord daemon start/stop/status/logs` manages a detached background Node process (pidfile + log file under `~/.claude-discord/`). A `systemd --user` unit is documented in the README, not auto-installed.

**settings.json integration:** hooks (`PermissionRequest` matcher `.*`; `Notification` matchers `agent_needs_input`/`idle_prompt`/`agent_completed`; `SessionStart` matchers `startup`/`resume`) are installed into the **user-level** `~/.claude/settings.json` by `claude-discord init`, using the resolved absolute path to the installed `claude-discord-hook` bin.

**Discord bot requirements:** Message Content privileged intent (to read steering replies), plus permission to create threads, send messages, and add reactions in the target channel — called out explicitly by `claude-discord init`.

## Testing Decisions

A good test here exercises externally observable behavior — HTTP requests/responses at the daemon boundary, or actual tmux pane content — never internal function call sequences.

**Seam 1 (primary): the daemon's HTTP layer, in-process.** Boot the real `daemon/run.js` server (or its `http.Server` instance) in the test process and drive it with real HTTP requests carrying the same payloads the hook scripts send (`/health`, `/hook/permission-request`, `/hook/notification`, `/hook/session-start`, `/register`, `/control/pause`, `/control/resume`). Two collaborators are replaced with test doubles at their module boundary, not mocked internally:
- A fake Discord client implementing just enough of the discord.js `Client`/`Message`/`MessageReaction` surface (thread creation, posting messages, adding reactions, and emitting `MessageReactionAdd`/`MessageCreate`/`InteractionCreate` events) to drive `src/discord/*` handlers exactly as the real gateway would.
- A spy `tmux.js` recording `sendText`/`newSession` calls instead of shelling out.

This single seam covers: permission approve/deny, auto-allowed calls never reaching Discord (asserted by absence of a fake-client call), idle/steering delivery, thread naming per project, pause/resume via both CLI-style state edits and `/control` HTTP calls, immediate effect of the pause flag, multi-session isolation (two registered sessions, a reaction/reply in one thread never touches the other's tmux spy calls), and session identification (token → `session_id` promotion via `SessionStart`).

The hook scripts themselves (`src/hooks/*.js`) are tested by calling their exported handler functions directly with a mocked `httpClient` — including the fail-fast path, where the liveness probe is pointed at a port with nothing listening and the hook must exit within its ~1.5s budget printing nothing.

**Seam 2 (secondary, thin): `src/tmux.js` against a real, ephemeral tmux session.** Since `execFile`-based argv-array `send-keys`/`new-session`/`capture-pane` against the real tmux binary is an OS-process boundary that fakes can't verify, a small integration test creates a throwaway tmux session, calls the real `tmux.js` functions against it, and asserts on `capturePane` output. This is deliberately narrow — it verifies the primitives work, not the higher-level flows (those are covered by seam 1's spy).

No prior art exists in this repo (new project) — these two seams are the testing foundation going forward; later specs should extend seam 1 rather than introduce new ones.

## Out of Scope

- Multi-user support — this is a single-user, personal tool; no per-user auth beyond the bot token.
- Per-project pause/resume — only a single global toggle exists.
- Any Claude API calls from the daemon — it is pure Discord + tmux + local IPC.
- Encrypting the token/config file beyond normal filesystem permissions.
- Auto-installing or managing the `systemd --user` unit — it's documented only.
- Windows support — the design depends on tmux, which implies Linux/macOS.
- Searchable history of past permission requests or steering messages beyond what's visible in the Discord thread itself.
- Rate-limit handling for Discord API beyond what discord.js provides by default.
- Any UI beyond Discord itself (no separate web dashboard).

## Further Notes

- A design pass explicitly verified hook JSON shapes against the current Claude Code hooks docs rather than assuming them, and surfaced two corrections baked into the decisions above: `PermissionRequest` only supports `decision.behavior` of `"allow"`/`"deny"` (no third "defer" value — deferring means printing nothing), and Node's `http.Server` has a default 5-minute `requestTimeout`/`headersTimeout` that must be zeroed in `daemon/run.js` or a held-open permission request gets killed regardless of the hook's own configured timeout.
- Critical-path files to implement first (per the originating plan): `src/daemon/routes/permissionRequest.js` (depends on the `requestTimeout = 0` fix), `src/hooks/permissionRequestHook.js` (two-phase fail-fast logic), `src/state.js` (shared atomic state), `src/cli/commands/start.js` (tmux session creation, token injection, daemon registration), `src/tmux.js` (safe argv-array `send-keys`).
- No `CONTEXT.md`/ADRs exist yet for this repo; once domain terms here (e.g. "session registry", "pending permission request", "steering") stabilize through implementation, they're candidates for `/domain-modeling` to capture.
