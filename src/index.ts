import { Client, Events, GatewayIntentBits } from "discord.js";
import { createLogger, loadEnv } from "./config/env.js";
import { loadConfig } from "./config/load.js";
import { handleCommand } from "./bot/commands.js";
import { checkSetupReadiness } from "./bot/hierarchy.js";
import { handleInteraction } from "./bot/interactions.js";
import { RoleRegistry } from "./bot/registry.js";
import { SYSTEM_ACTOR, type Logger } from "./logging/logger.js";
import { JsonFileStateStore } from "./state/store.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env);

  log.info(
    "bot.starting",
    SYSTEM_ACTOR,
    `Logging at ${env.logLevel}${env.logFile === "" ? " (console only)" : ` to ${env.logFile}`}`,
  );

  const config = await loadConfig(env.configPath);
  log.info(
    "config.loaded",
    SYSTEM_ACTOR,
    `${config.groups.length} group(s), ${config.groups.reduce((n, g) => n + g.roles.length, 0)} role(s) from ${env.configPath}`,
  );

  const store = new JsonFileStateStore(env.statePath);
  const registry = new RoleRegistry(config, store);

  // Only Guilds. Interactions carry the clicking member and their roles in the
  // payload, so neither the privileged GuildMembers intent nor a member cache
  // is needed.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (ready) => {
    const guild = ready.guilds.cache.get(env.guildId) ?? null;
    if (guild === null) {
      log.error(
        "bot.guild_missing",
        SYSTEM_ACTOR,
        `Logged in as ${ready.user.tag} but not a member of guild ${env.guildId}; invite the bot first.`,
      );
      return;
    }

    try {
      // create: false — a restart must never change the server. Roles missing
      // from Discord are reported here and created by /rolepicker setup.
      const resolution = await registry.refresh(guild, { create: false });

      log.info(
        "bot.ready",
        SYSTEM_ACTOR,
        `Logged in as ${ready.user.tag} in ${guild.name}, ${resolution.entries.length} role(s) resolved`,
      );

      for (const entry of resolution.unresolved) {
        log.warn("role.unresolved", SYSTEM_ACTOR, `${entry.label}: ${entry.reason}`);
      }

      // Surface setup problems at boot rather than on a member's first click.
      for (const problem of await checkSetupReadiness(guild, resolution.config)) {
        log.warn("setup.blocked", SYSTEM_ACTOR, problem.message);
      }
    } catch (error) {
      log.error(
        "error.unhandled",
        SYSTEM_ACTOR,
        `Could not resolve roles at startup: ${message(error)}`,
      );
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, registry, store, log);
        return;
      }
      await handleInteraction(interaction, registry, log);
    } catch (error) {
      log.error("error.unhandled", SYSTEM_ACTOR, `Unhandled interaction error: ${message(error)}`);
    }
  });

  installShutdownHandlers(client, log);

  await client.login(env.token);
}

/** Flush queued log lines before the process goes away. */
function installShutdownHandlers(client: Client, log: Logger): void {
  let shuttingDown = false;

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;

      log.info("bot.starting", SYSTEM_ACTOR, `Received ${signal}, shutting down`);
      void log.flush().finally(() => {
        void client.destroy();
        process.exit(0);
      });
    });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  // The logger may not exist yet (bad env, unreadable config), so this one
  // stays on the console.
  console.error(`[rolepicker] ${message(error)}`);
  process.exitCode = 1;
});
