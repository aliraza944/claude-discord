# 03 — Session start, thread creation, and session identification

**What to build:** starting a Claude Code session in tmux and having it show up immediately as its own Discord thread, with the session's real Claude Code `session_id` reliably reconciled to that thread.

From the user's perspective: I run `claude-discord start ~/some/project` and a tmux session launches with Claude Code inside it; a new Discord thread appears right away, named for the project. Once Claude Code actually boots, the daemon knows the session's real `session_id` and can attribute later events to the correct thread with certainty — not a cwd-recency guess. Running `start` against two different projects concurrently produces two independent threads and registry entries.

**Blocked by:** 02 — Discord bot connection + init wizard

**Status:** done

- [ ] `src/tmux.js` wraps the real `tmux` binary (`newSession`, `sendText`, `hasSession`, `capturePane`) using `execFile` with an argv array — never `shell: true`.
- [ ] `src/httpClient.js` provides a `fetch` wrapper accepting a per-call `AbortSignal.timeout`.
- [ ] `src/daemon/sessions.js` implements a session registry: register a session as pending-by-token, promote it to active-by-`session_id`, and look it up by either key.
- [ ] `src/daemon/routes/register.js` accepts a new pending session registration and creates its Discord thread immediately (named for the project).
- [ ] `src/daemon/routes/session-start.js` accepts the `SessionStart` hook's payload (token + real `session_id`) and promotes the matching pending registration to active.
- [ ] `src/discord/threads.js` provides `createSessionThread` and `postToThread`.
- [ ] `src/hooks/sessionStartHook.js` reads the `CLAUDE_DISCORD_TOKEN` env var and the hook's `session_id`, and reports both to the daemon; wired into `bin/claude-discord-hook.js`'s dispatch.
- [ ] `claude-discord start <path>` generates a token, creates a uniquely-named tmux session, launches `claude` inside it with `CLAUDE_DISCORD_TOKEN` set inline, and registers `{token, projectName, cwd, tmuxTarget}` with the daemon.
- [ ] Two concurrent `start` calls against different project directories produce two distinct threads with independent, non-colliding registry entries.
