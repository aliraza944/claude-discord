/** Waits `ms` milliseconds — used across the daemon/feed-watcher test suites to let polling/async work settle before asserting. */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
