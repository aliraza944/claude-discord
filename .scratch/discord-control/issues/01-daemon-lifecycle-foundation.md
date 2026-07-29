# 01 — Project & daemon lifecycle foundation

**What to build:** the base `claude-discord` package and the ability to start, stop, and check on the background daemon from the CLI, with shared atomic state that later tickets build on.

From the user's perspective: I can install the tool, run `claude-discord daemon start`, see it running in the background, run `claude-discord status` and see it's running and not paused, and run `claude-discord daemon stop` to cleanly shut it down.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] New Node.js ESM package with `package.json` declaring the `claude-discord` and `claude-discord-hook` bins.
- [ ] `claude-discord-hook` bin exists as a stub that dispatches by `argv[2]` (handlers wired up in later tickets).
- [ ] `state.js` provides atomic read/modify/write of `~/.claude-discord/state.json`, holding a `paused` boolean and a session registry, usable by both the CLI and the daemon.
- [ ] `config.js` provides read/write of `~/.claude-discord/config.json`.
- [ ] The daemon boots an HTTP server with `requestTimeout`/`headersTimeout` explicitly set to `0`, and exposes a `/health` route.
- [ ] `claude-discord daemon start` launches a detached background process (pidfile + log file under `~/.claude-discord/`); `daemon stop` stops it; `daemon status` reports running/not running; `daemon logs` shows the log file.
- [ ] `claude-discord status` reports whether the daemon is running and the current `paused` flag (bot connection state can report "not configured" — wired up in ticket 02).
- [ ] README documents an optional `systemd --user` unit for auto-start on login (not auto-installed).
