import { EventEmitter } from 'node:events';

/**
 * A fake discord.js Client used across the daemon HTTP-layer tests (see
 * spec.md's "Seam 1"). Implements just enough surface — login/ready state,
 * plus whatever event emission later tickets need — to drive src/discord/*
 * handlers the same way the real gateway would, without a network call.
 */
export function createFakeDiscordClient() {
  const client = new EventEmitter();
  client.ready = false;
  client.loginCalls = [];

  client.isReady = () => client.ready;

  client.login = async (token) => {
    client.loginCalls.push(token);
    client.ready = true;
    client.emit('ready');
    return token;
  };

  client.destroy = async () => {
    client.ready = false;
  };

  return client;
}
