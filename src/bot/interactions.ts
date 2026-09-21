import {
  DiscordAPIError,
  GuildMember,
  MessageFlags,
  type Interaction,
  type RepliableInteraction,
} from "discord.js";
import type { RoleGroup, RolePickerConfig } from "../config/types.js";
import {
  describePlan,
  planButtonClick,
  planMenuSubmit,
  type SelectionPlan,
} from "../core/selection.js";
import { parseComponentId } from "../ui/customId.js";

/**
 * Routes every picker component through the same path: find the group, ask the
 * core what to do, apply it, tell the member privately.
 */
export async function handleInteraction(
  interaction: Interaction,
  config: RolePickerConfig,
): Promise<void> {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const ref = parseComponentId(interaction.customId);
  if (ref === null) return;

  const group = config.groups.find((candidate) => candidate.key === ref.groupKey);
  if (group === undefined) {
    await replyPrivately(
      interaction,
      "That picker is out of date — an admin needs to run `/rolepicker setup` again.",
    );
    return;
  }

  const member = interaction.member;
  if (!(member instanceof GuildMember)) {
    await replyPrivately(interaction, "Roles can only be picked inside the server.");
    return;
  }

  const currentRoleIds = member.roles.cache.map((role) => role.id);

  let plan: SelectionPlan;
  if (ref.kind === "button" && interaction.isButton()) {
    plan = planButtonClick(group, currentRoleIds, ref.roleKey);
  } else if (ref.kind === "menu" && interaction.isStringSelectMenu()) {
    plan = planMenuSubmit(group, currentRoleIds, interaction.values);
  } else {
    // custom_id says one component type, Discord delivered another: the picker
    // message predates a display change. A fresh setup fixes it.
    await replyPrivately(
      interaction,
      "That picker is out of date — an admin needs to run `/rolepicker setup` again.",
    );
    return;
  }

  if (plan.rejection !== undefined) {
    await replyPrivately(interaction, plan.rejection);
    return;
  }

  try {
    await applyPlan(member, plan, group);
  } catch (error) {
    await replyPrivately(interaction, explainFailure(error, group));
    return;
  }

  await replyPrivately(interaction, describePlan(group, plan));
}

async function applyPlan(
  member: GuildMember,
  plan: SelectionPlan,
  group: RoleGroup,
): Promise<void> {
  if (plan.add.length === 0 && plan.remove.length === 0) return;

  // One edit rather than add-then-remove: a member never sits in a state the
  // group's own rules forbid, and it costs a single rate-limited call.
  const next = new Set(member.roles.cache.map((role) => role.id));
  for (const roleId of plan.remove) next.delete(roleId);
  for (const roleId of plan.add) next.add(roleId);

  await member.roles.set([...next], `Role picker: ${group.key}`);
}

function explainFailure(error: unknown, group: RoleGroup): string {
  if (error instanceof DiscordAPIError && error.code === 50013) {
    return `I don't have permission to change your **${group.label}** roles. An admin needs to move my role above them in Server Settings -> Roles.`;
  }
  console.error(`[rolepicker] failed to apply group "${group.key}":`, error);
  return "Something went wrong applying that. Try again, and ping an admin if it keeps failing.";
}

async function replyPrivately(
  interaction: RepliableInteraction,
  content: string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    // The interaction token expired (3s to first response) or Discord hiccuped.
    // The role change already happened; nothing is gained by crashing.
    console.error("[rolepicker] could not reply to interaction:", error);
  }
}
