import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadEnv } from "./config/env.js";
import { loadConfig } from "./config/load.js";
import { handleCommand } from "./bot/commands.js";
import { checkSetupReadiness } from "./bot/hierarchy.js";
import { handleInteraction } from "./bot/interactions.js";
import { RoleRegistry } from "./bot/registry.js";
import { JsonFileStateStore } from "./state/store.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const config = await loadConfig(env.configPath);
  const store = new JsonFileStateStore(env.statePath);
  const registry = new RoleRegistry(config, store);

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

    try {
      // create: false — a restart must never change the server. Roles missing
      // from Discord are reported here and created by /rolepicker setup.
      const resolution = await registry.refresh(guild, { create: false });

      for (const entry of resolution.unresolved) {
        console.warn(`[rolepicker] ${entry.label}: ${entry.reason}`);
      }

      // Surface setup problems at boot rather than on a member's first click.
      for (const problem of await checkSetupReadiness(guild, resolution.config)) {
        console.warn(`[rolepicker] ${problem.message}`);
      }
    } catch (error) {
      console.error("[rolepicker] could not resolve roles at startup:", error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, registry, store);
        return;
      }
      await handleInteraction(interaction, registry);
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
