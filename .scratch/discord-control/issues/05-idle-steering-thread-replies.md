# 05 — Idle/steering via thread replies

**What to build:** notifying the user when a session goes idle, and letting them steer it by replying in its thread.

From the user's perspective: when a session goes idle waiting for input, a "this session needs input" message posts to its thread. If I reply with plain text in that thread, it's actually typed into that session's tmux pane, and the bot reacts to my reply to confirm delivery. A reply in one session's thread never reaches another session's pane.

**Blocked by:** 03 — session start, thread creation, and session identification

**Status:** done

- [ ] `src/hooks/notificationHook.js` fire-and-forget POSTs the `Notification` hook payload to `/hook/notification` for matchers `agent_needs_input`, `idle_prompt`, `agent_completed`; wired into `bin/claude-discord-hook.js`'s dispatch.
- [ ] `src/daemon/routes/notification.js` posts an FYI message to the session's thread.
- [ ] `src/discord/steering.js` handles `MessageCreate` for messages posted inside a session's thread, delivering the text via `tmux.sendText()` into that session's registered tmux pane (argv-array `execFile`, never a shell, since the text originates from Discord), and reacts to the message to acknowledge delivery.
- [ ] With two sessions registered, a plain-text reply in one session's thread is only ever delivered to that session's own tmux pane, verified via `tmux capture-pane`.
