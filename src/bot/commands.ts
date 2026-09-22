import {
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { StateStore } from "../state/store.js";
import { formatGroupState } from "../core/selection.js";
import { checkSetupReadiness } from "./hierarchy.js";
import type { RoleRegistry } from "./registry.js";
import type { ResolutionResult } from "./roleResolver.js";
import { runSetup } from "./setup.js";

export const rolePickerCommand = new SlashCommandBuilder()
  .setName("rolepicker")
  .setDescription("Manage the self-service role picker")
  // Admin-only by default; the buttons themselves stay open to everyone.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("Post or refresh the picker, creating any roles that do not exist yet"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("check")
      .setDescription("Verify the bot can assign every configured role, without changing anything"),
  )
  .addSubcommand((sub) =>
    sub.setName("mine").setDescription("Show the roles you currently hold in each group"),
  );

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  registry: RoleRegistry,
  store: StateStore,
): Promise<void> {
  if (interaction.commandName !== rolePickerCommand.name) return;

  switch (interaction.options.getSubcommand()) {
    case "setup":
      return handleSetup(interaction, registry, store);
    case "check":
      return handleCheck(interaction, registry);
    case "mine":
      return handleMine(interaction, registry);
    default:
      await interaction.reply({ content: "Unknown subcommand.", flags: MessageFlags.Ephemeral });
  }
}

async function handleSetup(
  interaction: ChatInputCommandInteraction,
  registry: RoleRegistry,
  store: StateStore,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  if (guild === null) {
    await interaction.editReply("This command only works inside a server.");
    return;
  }

  // Setup is the one explicit admin action, so it is where missing roles get
  // created — never as a side effect of the bot restarting.
  const resolution = await registry.refresh(guild, { create: true });

  const problems = await checkSetupReadiness(guild, resolution.config);
  if (problems.length > 0) {
    await interaction.editReply(
      ["Setup stopped — fix these first:", ...problems.map((p) => `• ${p.message}`)].join("\n"),
    );
    return;
  }

  try {
    const result = await runSetup(interaction.client, resolution.config, store);
    const lines = [`Picker is live in <#${resolution.config.channelId}>.`];

    const created = resolution.entries.filter((entry) => entry.source === "created");
    const matched = resolution.entries.filter((entry) => entry.source === "matched");
    if (created.length > 0) {
      lines.push(`Created roles: ${created.map((entry) => entry.label).join(", ")}`);
    }
    if (matched.length > 0) {
      lines.push(`Linked existing roles by name: ${matched.map((e) => e.label).join(", ")}`);
    }

    if (result.posted.length > 0) lines.push(`Posted: ${result.posted.join(", ")}`);
    if (result.edited.length > 0) lines.push(`Updated: ${result.edited.join(", ")}`);
    if (result.orphaned.length > 0) {
      lines.push(
        `Left over from removed groups (delete the messages by hand if you want them gone): ${result.orphaned.join(", ")}`,
      );
    }
    lines.push(...resolutionWarnings(resolution));

    await interaction.editReply(lines.join("\n"));
  } catch (error) {
    // The preflight above catches this in the normal case; a permission changed
    // mid-run still deserves better than Discord's bare "Missing Permissions".
    if (error instanceof DiscordAPIError && error.code === 50013) {
      await interaction.editReply(
        `Setup failed: Discord refused to let the bot post in <#${resolution.config.channelId}>. Check the channel's own permissions (Edit Channel -> Permissions) for "View Channel", "Send Messages" and "Embed Links" — channel overwrites beat the invite link's permissions.`,
      );
      return;
    }
    await interaction.editReply(`Setup failed: ${(error as Error).message}`);
  }
}

async function handleCheck(
  interaction: ChatInputCommandInteraction,
  registry: RoleRegistry,
): Promise<void> {
  const guild = interaction.guild;
  if (guild === null) {
    await interaction.reply({
      content: "This command only works inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // create: false — check reports, it never changes the server.
  const resolution = await registry.refresh(guild, { create: false });
  const problems = await checkSetupReadiness(guild, resolution.config);

  const lines: string[] = [];
  const roleCount = resolution.entries.length;

  if (problems.length === 0 && resolution.unresolved.length === 0) {
    lines.push(
      `All good — ${resolution.config.groups.length} group(s), ${roleCount} role(s), all assignable, and the bot can post in <#${resolution.config.channelId}>.`,
    );
  } else {
    if (problems.length > 0) {
      lines.push("Problems found:", ...problems.map((p) => `• ${p.message}`));
    }
    lines.push(...resolutionWarnings(resolution));
  }

  await interaction.editReply(lines.join("\n"));
}

/** Roles that could not be resolved, and groups left unrenderable as a result. */
function resolutionWarnings(resolution: ResolutionResult): string[] {
  const lines: string[] = [];
  if (resolution.unresolved.length > 0) {
    lines.push(
      "Roles not resolved yet:",
      ...resolution.unresolved.map((entry) => `• ${entry.label} — ${entry.reason}`),
    );
  }
  if (resolution.emptyGroupKeys.length > 0) {
    lines.push(
      `Groups skipped because none of their roles resolved: ${resolution.emptyGroupKeys.join(", ")}`,
    );
  }
  return lines;
}

async function handleMine(
  interaction: ChatInputCommandInteraction,
  registry: RoleRegistry,
): Promise<void> {
  const member = interaction.member;
  const config = registry.resolved;

  if (member === null || !("roles" in member) || typeof member.roles === "string") {
    await interaction.reply({
      content: "This command only works inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (config === undefined) {
    await interaction.reply({
      content: "The picker has not been set up yet — run `/rolepicker setup`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentRoleIds =
    "cache" in member.roles ? member.roles.cache.map((role) => role.id) : member.roles;

  const lines = config.groups.map(
    (group) => `**${group.label}**\n${formatGroupState(group, currentRoleIds)}`,
  );

  await interaction.reply({ content: lines.join("\n\n"), flags: MessageFlags.Ephemeral });
}
