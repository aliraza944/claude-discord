#!/usr/bin/env node
import { Command } from 'commander';
import { statusCommand } from '../src/cli/commands/status.js';
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
