import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { RolePickerConfig } from "../config/types.js";
import type { StateStore } from "../state/store.js";
import { heldRoles } from "../core/selection.js";
import { checkHierarchy } from "./hierarchy.js";
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
      .setDescription("Post or refresh the picker messages from the config file"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("check")
      .setDescription("Verify the bot can actually assign every configured role"),
  )
  .addSubcommand((sub) =>
    sub.setName("mine").setDescription("Show the roles you currently hold in each group"),
  );

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  config: RolePickerConfig,
  store: StateStore,
): Promise<void> {
  if (interaction.commandName !== rolePickerCommand.name) return;

  switch (interaction.options.getSubcommand()) {
    case "setup":
      return handleSetup(interaction, config, store);
    case "check":
      return handleCheck(interaction, config);
    case "mine":
      return handleMine(interaction, config);
    default:
      await interaction.reply({ content: "Unknown subcommand.", flags: MessageFlags.Ephemeral });
  }
}

async function handleSetup(
  interaction: ChatInputCommandInteraction,
  config: RolePickerConfig,
  store: StateStore,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  if (guild === null) {
    await interaction.editReply("This command only works inside a server.");
    return;
  }

  // Posting a picker whose roles the bot cannot grant just moves the failure to
  // the first member who clicks, so refuse up front.
  const problems = checkHierarchy(guild, config);
  if (problems.length > 0) {
    await interaction.editReply(
      ["Setup stopped — fix these first:", ...problems.map((p) => `• ${p.message}`)].join("\n"),
    );
    return;
  }

  try {
    const result = await runSetup(interaction.client, config, store);
    const lines = [`Picker is live in <#${config.channelId}>.`];
    if (result.posted.length > 0) lines.push(`Posted: ${result.posted.join(", ")}`);
    if (result.edited.length > 0) lines.push(`Updated: ${result.edited.join(", ")}`);
    if (result.orphaned.length > 0) {
      lines.push(
        `Left over from removed groups (delete the messages by hand if you want them gone): ${result.orphaned.join(", ")}`,
      );
    }
    await interaction.editReply(lines.join("\n"));
  } catch (error) {
    await interaction.editReply(`Setup failed: ${(error as Error).message}`);
  }
}

async function handleCheck(
  interaction: ChatInputCommandInteraction,
  config: RolePickerConfig,
): Promise<void> {
  const guild = interaction.guild;
  if (guild === null) {
    await interaction.reply({
      content: "This command only works inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const problems = checkHierarchy(guild, config);
  const roleCount = config.groups.reduce((total, group) => total + group.roles.length, 0);

  const content =
    problems.length === 0
      ? `All good — ${config.groups.length} group(s), ${roleCount} role(s), all assignable.`
      : ["Problems found:", ...problems.map((p) => `• ${p.message}`)].join("\n");

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleMine(
  interaction: ChatInputCommandInteraction,
  config: RolePickerConfig,
): Promise<void> {
  const member = interaction.member;
  if (member === null || !("roles" in member) || typeof member.roles === "string") {
    await interaction.reply({
      content: "This command only works inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentRoleIds =
    "cache" in member.roles ? member.roles.cache.map((role) => role.id) : member.roles;

  const lines = config.groups.map((group) => {
    const held = heldRoles(group, currentRoleIds);
    const picks = held.length === 0 ? "_nothing picked_" : held.map((r) => r.label).join(", ");
    return `**${group.label}**: ${picks}`;
  });

  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}
