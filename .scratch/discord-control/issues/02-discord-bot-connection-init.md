# 02 — Discord bot connection + init wizard

**What to build:** the ability to configure the tool with a Discord bot and have the daemon actually connect to it.

From the user's perspective: I run `claude-discord init`, enter my bot token/guild/channel, and it tells me explicitly that the bot needs the Message Content intent plus thread/message/reaction permissions. It writes my config and installs the required hooks into `~/.claude/settings.json`. When I start the daemon, `claude-discord status` shows the bot as online.

**Blocked by:** 01 — daemon lifecycle foundation

**Status:** ready-for-agent

- [ ] `src/discord/client.js` constructs a discord.js `Client` with the intents/partials needed for guild messages, message content, and message reactions.
- [ ] `claude-discord init` prompts for bot token, guild ID, and channel ID, and writes them to `config.json`.
- [ ] `claude-discord init` writes the `PermissionRequest` (matcher `.*`), `Notification` (matchers `agent_needs_input`/`idle_prompt`/`agent_completed`), and `SessionStart` (matchers `startup`/`resume`) hooks block into the user-level `~/.claude/settings.json`, using the resolved absolute path to the installed `claude-discord-hook` bin.
- [ ] `claude-discord init` explicitly prints that the bot needs the Message Content privileged intent enabled in the Developer Portal, plus permission to create threads, send messages, and add reactions in the target channel.
- [ ] `daemon/run.js` connects the Discord client on startup using the saved config.
- [ ] `claude-discord status` reports the bot as online/offline based on the daemon's live Discord connection state.
