const ONE_DAY_MINUTES = 1440;

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
