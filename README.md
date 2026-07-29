# claude-discord

Two-way Discord control for Claude Code sessions. Runs a local background
daemon that bridges Claude Code sessions (in tmux panes) to a Discord server:
approve/deny permission prompts and steer idle sessions from your phone.

## Install

```sh
npm install -g .
```

This installs two bins: `claude-discord` (the CLI) and `claude-discord-hook`
(invoked by Claude Code's hook system — you won't run it directly).

## Quick start

```sh
claude-discord init            # configure bot token / guild / channel, install hooks
claude-discord daemon start    # start the background daemon
claude-discord status          # confirm it's running, unpaused, and the bot is online
claude-discord start ~/some/project   # launch a session in tmux, wired to Discord
```

## Config and state

Everything lives under `~/.claude-discord/`:

- `config.json` — bot token, guild ID, channel ID, HTTP port.
- `state.json` — the global `paused` flag and the session registry.
- `daemon.pid` / `daemon.log` — background process bookkeeping.

Set `CLAUDE_DISCORD_HOME` to point all of the above somewhere else (used by
this project's own tests, and available if you want an isolated setup).

## Daemon lifecycle

```sh
claude-discord daemon start   # spawn the daemon, detached, in the background
claude-discord daemon status  # running / not running
claude-discord daemon stop    # SIGTERM the daemon
claude-discord daemon logs    # print daemon.log
```

## Auto-start on login (optional)

`claude-discord daemon start` isn't installed as a service automatically —
if you want it running after every login, create a `systemd --user` unit
yourself:

`~/.config/systemd/user/claude-discord.service`:

```ini
[Unit]
Description=claude-discord daemon
After=network-online.target

[Service]
Type=forking
PIDFile=%h/.claude-discord/daemon.pid
ExecStart=/usr/bin/env claude-discord daemon start
ExecStop=/usr/bin/env claude-discord daemon stop
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
