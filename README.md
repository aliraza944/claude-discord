# claude-discord

Two-way Discord control for Claude Code sessions. Runs a local background
daemon that bridges Claude Code sessions (in tmux panes) to a Discord server:
approve/deny permission prompts and steer idle sessions from your phone.

## Install

```sh
npm install -g .
```

This installs two bins: `discord` (the CLI) and `claude-discord-hook`
(invoked by Claude Code's hook system — you won't run it directly).

## Quick start

```sh
discord init            # configure bot token / guild / channel, install hooks
discord status           # confirm it's running, unpaused, and the bot is online
discord start ~/some/project   # launch a session in tmux, wired to Discord
```

`discord attach` checks whether the daemon is already running and starts it
automatically if not, so you generally don't need to run
`discord daemon start` yourself before attaching a session.

## Config and state

Everything lives under `~/.claude-discord/`:

- `config.json` — bot token, guild ID, channel ID, HTTP port.
- `state.json` — the global `paused` flag and the session registry.
- `daemon.pid` / `daemon.log` — background process bookkeeping.

Set `CLAUDE_DISCORD_HOME` to point all of the above somewhere else (used by
this project's own tests, and available if you want an isolated setup).

## Daemon lifecycle

```sh
discord daemon start   # spawn the daemon, detached, in the background
discord daemon status  # running / not running
discord daemon stop    # SIGTERM the daemon
discord daemon logs    # print daemon.log
```

## Auto-start on login (optional)

`discord daemon start` isn't installed as a service automatically — `discord
attach` starts it on demand, but if you want it running after every login
regardless (e.g. so `discord start` doesn't need it started first), create a
`systemd --user` unit yourself:

`~/.config/systemd/user/claude-discord.service`:

```ini
[Unit]
Description=claude-discord daemon
After=network-online.target

[Service]
Type=forking
PIDFile=%h/.claude-discord/daemon.pid
ExecStart=/usr/bin/env discord daemon start
ExecStop=/usr/bin/env discord daemon stop
Restart=on-failure

[Install]
WantedBy=default.target
```

Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now claude-discord.service
```

`Type=forking` works here because `daemon start` spawns the real daemon
detached and exits immediately — systemd tracks the child via the pidfile
convention, not by keeping `daemon start` itself alive.

## Development

```sh
npm install
npm test          # vitest
npm run typecheck # tsc --checkJs over jsconfig.json
```
