import { REST, Routes } from "discord.js";
import { rolePickerCommand } from "../bot/commands.js";
import { loadEnv } from "../config/env.js";

/**
 * Registers the slash commands for one guild. Guild commands appear instantly;
 * global ones can take up to an hour to propagate.
 *
 * Run once after cloning, and again whenever the command definition changes.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const rest = new REST().setToken(env.token);

  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), {
    body: [rolePickerCommand.toJSON()],
  });

  console.log(`[rolepicker] registered /rolepicker in guild ${env.guildId}`);
}

main().catch((error: unknown) => {
  console.error(`[rolepicker] command deploy failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
