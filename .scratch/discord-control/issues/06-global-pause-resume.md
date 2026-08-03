# 06 — Global pause/resume (CLI + Discord)

**What to build:** a single global on/off switch for Discord control, flippable from either the CLI or Discord itself.

From the user's perspective: I run `claude-discord pause` (or type `/pause` in Discord) and a subsequent permission call falls straight back to the local prompt instead of going to Discord, and idle notifications stop posting. Running `claude-discord resume` (or `/resume`) immediately restores both — no restart needed. Pause/resume from the CLI still works, via a direct edit to the state file, even when the daemon isn't running.

**Blocked by:** 04 — permission approval via reactions, 05 — idle/steering via thread replies

**Status:** done

- [ ] `src/daemon/routes/control.js` exposes HTTP pause/resume endpoints that flip the `paused` flag in `state.js`.
- [ ] `claude-discord pause` / `claude-discord resume` call the HTTP route when the daemon is up, and fall back to a direct read-modify-write of `state.json` when it's down.
- [ ] `src/discord/slashCommands.js` registers and handles `/pause` and `/resume`, calling the same underlying `setPaused` path as the CLI.
- [ ] `src/daemon/routes/permission-request.js` and `src/daemon/routes/notification.js` read the `paused` flag fresh on every call, so toggling takes effect immediately for in-flight and future hook calls with no daemon restart.
- [ ] While paused, a permission call falls back to the local prompt instead of posting to Discord, and idle notifications are suppressed; after resuming, both go back to Discord.
- [ ] With the daemon stopped, `claude-discord pause`/`resume` still succeed via the direct state-file fallback.
