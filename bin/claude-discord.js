#!/usr/bin/env node
import { Command } from 'commander';
import { statusCommand } from '../src/cli/commands/status.js';
import { initCommand } from '../src/cli/commands/init.js';
import { startCommand } from '../src/cli/commands/start.js';
import { pauseCommand, resumeCommand } from '../src/cli/commands/control.js';
import {
  daemonStartCommand,
  daemonStopCommand,
  daemonStatusCommand,
  daemonLogsCommand,
  daemonRunCommand,
} from '../src/cli/commands/daemon.js';

const program = new Command();
program.name('claude-discord').description('Two-way Discord control for Claude Code sessions');

program
  .command('status')
  .description('Show daemon, pause, and Discord bot connection status')
  .action(statusCommand);

program
  .command('init')
  .description('Configure the Discord bot and install the required Claude Code hooks')
  .option('--token <token>', 'Discord bot token')
  .option('--guild <guildId>', 'Discord guild (server) ID')
  .option('--channel <channelId>', 'Discord channel ID')
  .action((opts) => initCommand({ token: opts.token, guildId: opts.guild, channelId: opts.channel }));

program
  .command('start <path>')
  .description('Launch a Claude Code session in tmux, wired up for Discord control')
  .action((path) => startCommand(path));

program
  .command('pause')
  .description('Pause Discord control: permission requests fall back to the local prompt and idle notifications stop')
  .action(() => pauseCommand());

program
  .command('resume')
  .description('Resume Discord control after a pause')
  .action(() => resumeCommand());

const daemon = program.command('daemon').description('Manage the background daemon process');

daemon
  .command('start')
  .description('Start the daemon in the background')
  .action(daemonStartCommand);

daemon.command('stop').description('Stop the background daemon').action(daemonStopCommand);

daemon
  .command('status')
  .description('Report whether the daemon is running')
  .action(daemonStatusCommand);

daemon.command('logs').description('Print the daemon log file').action(daemonLogsCommand);

daemon
  .command('run')
  .description('Run the daemon in the foreground (used internally by `daemon start`)')
  .action(daemonRunCommand);

await program.parseAsync(process.argv);
