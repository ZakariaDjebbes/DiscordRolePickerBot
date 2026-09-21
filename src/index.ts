import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadEnv } from "./config/env.js";
import { loadConfig } from "./config/load.js";
import { handleCommand } from "./bot/commands.js";
import { checkHierarchy } from "./bot/hierarchy.js";
import { handleInteraction } from "./bot/interactions.js";
import { JsonFileStateStore } from "./state/store.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const config = await loadConfig(env.configPath);
  const store = new JsonFileStateStore(env.statePath);

  // Only Guilds. Interactions carry the clicking member and their roles in the
  // payload, so neither the privileged GuildMembers intent nor a member cache
  // is needed.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (ready) => {
    console.log(`[rolepicker] logged in as ${ready.user.tag}`);

    const guild = ready.guilds.cache.get(env.guildId) ?? null;
    if (guild === null) {
      console.warn(`[rolepicker] not a member of guild ${env.guildId}; invite the bot first.`);
      return;
    }

    // Surface the hierarchy problem at boot rather than on a member's click.
    for (const problem of checkHierarchy(guild, config)) {
      console.warn(`[rolepicker] ${problem.message}`);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, config, store);
        return;
      }
      await handleInteraction(interaction, config);
    } catch (error) {
      console.error("[rolepicker] unhandled interaction error:", error);
    }
  });

  await client.login(env.token);
}

main().catch((error: unknown) => {
  console.error(`[rolepicker] ${(error as Error).message}`);
  process.exitCode = 1;
});
