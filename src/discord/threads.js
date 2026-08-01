const ONE_DAY_MINUTES = 1440;

/**
 * Formats a thread name as "{projectName} — {YYYY-MM-DD HH:mm}" (local
 * time, minute precision), so concurrent sessions against the same project
 * produce distinguishable threads. Shared by both the `start` flow (register
 * route) and the `attach` flow so the format lives in exactly one place.
 */
export function formatThreadName(projectName, now) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${projectName} — ${date} ${time}`;
}

/** Creates a new thread named for the project in the configured channel. */
export async function createSessionThread(discordClient, { channelId, name }) {
  const channel = await discordClient.channels.fetch(channelId);
  return channel.threads.create({ name, autoArchiveDuration: ONE_DAY_MINUTES });
}

/** Posts `content` to an existing thread by id. */
export async function postToThread(discordClient, threadId, content) {
  const thread = await discordClient.channels.fetch(threadId);
  return thread.send(content);
}

/** Deletes a thread by id. */
export async function deleteThread(discordClient, threadId) {
  const thread = await discordClient.channels.fetch(threadId);
  return thread.delete();
}

/**
 * Deletes the "X started a thread" system message Discord posts in the
 * parent channel when a thread is created without a starting message (as
 * `createSessionThread` always does). That message's id is always identical
 * to the thread's own id, so no extra bookkeeping is needed to find it —
 * deleting the thread itself does not remove this message, it just orphans
 * it, so this must be called alongside `deleteThread` to actually clean it up.
 */
export async function deleteThreadStarterMessage(discordClient, channelId, threadId) {
  const channel = await discordClient.channels.fetch(channelId);
  return channel.messages.delete(threadId);
}
