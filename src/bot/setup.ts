import { ChannelType, type Client, type TextChannel } from "discord.js";
import type { ResolvedConfig } from "../config/types.js";
import type { StateStore } from "../state/store.js";
import { renderGroup } from "../ui/render.js";

export interface SetupResult {
  posted: string[];
  edited: string[];
  orphaned: string[];
}

/**
 * Posts or updates one picker message per group.
 *
 * Idempotent: a group whose message ID is remembered and still exists is edited
 * in place, so running setup after a config change does not litter the channel.
 */
export async function runSetup(
  client: Client,
  config: ResolvedConfig,
  store: StateStore,
): Promise<SetupResult> {
  const channel = await client.channels.fetch(config.channelId);

  if (channel === null || channel.type !== ChannelType.GuildText) {
    throw new Error(
      `channelId ${config.channelId} is not a text channel the bot can see. Check the ID and the bot's channel permissions.`,
    );
  }

  const textChannel = channel as TextChannel;
  const result: SetupResult = { posted: [], edited: [], orphaned: [] };

  for (const group of config.groups) {
    const payload = renderGroup(group);
    const knownId = await store.getMessageId(group.key);

    if (knownId !== undefined) {
      try {
        const existing = await textChannel.messages.fetch(knownId);
        await existing.edit(payload);
        result.edited.push(group.key);
        continue;
      } catch {
        // Deleted by a mod, or in a channel we no longer read. Post a new one.
        await store.forget(group.key);
      }
    }

    const message = await textChannel.send(payload);
    await store.setMessageId(group.key, message.id);
    result.posted.push(group.key);
  }

  // Groups dropped from the config leave a stale message behind. Report them
  // rather than deleting: removing messages is the admin's call.
  result.orphaned = await store.orphanedGroupKeys(config.groups.map((group) => group.key));

  return result;
}
