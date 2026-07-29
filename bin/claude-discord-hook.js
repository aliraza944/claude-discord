#!/usr/bin/env node
// Dispatches Claude Code hook invocations by argv[2]. Each handler module is
// wired up as its owning ticket implements it; loading them lazily means this
// stub works before those files exist.
const HANDLER_LOADERS = {
  'permission-request': () => import('../src/hooks/permissionRequestHook.js'),
  notification: () => import('../src/hooks/notificationHook.js'),
  'session-start': () => import('../src/hooks/sessionStartHook.js'),
};

async function main() {
  const name = process.argv[2];
  const loader = HANDLER_LOADERS[name];
  if (!loader) {
    process.exit(0);
  }
  const mod = await loader();
  await mod.run();
}

main();
