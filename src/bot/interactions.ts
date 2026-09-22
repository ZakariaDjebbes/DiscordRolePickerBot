import {
  DiscordAPIError,
  GuildMember,
  MessageFlags,
  type Interaction,
  type RepliableInteraction,
} from "discord.js";
import type { ResolvedGroup } from "../config/types.js";
import {
  describePlanWithState,
  heldRoles,
  planButtonClick,
  planMenuSubmit,
  rolesAfterPlan,
  type SelectionPlan,
} from "../core/selection.js";
import { parseComponentId } from "../ui/customId.js";
import { memberActor, type Actor, type Logger } from "../logging/logger.js";
import type { RoleRegistry } from "./registry.js";

/**
 * Routes every picker component through the same path: find the group, ask the
 * core what to do, apply it, tell the member privately.
 */
export async function handleInteraction(
  interaction: Interaction,
  registry: RoleRegistry,
  log: Logger,
): Promise<void> {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const ref = parseComponentId(interaction.customId);
  if (ref === null) return;

  const actor = memberActor(interaction.user.id, interaction.user.username);
  const staleNotice = "That picker is out of date — an admin needs to run `/rolepicker setup` again.";

  const config = registry.resolved;
  const group = config?.groups.find((candidate) => candidate.key === ref.groupKey);
  if (group === undefined) {
    log.warn("selection.rejected", actor, `Clicked a picker for unknown group "${ref.groupKey}"`);
    await replyPrivately(interaction, staleNotice, log, actor);
    return;
  }

  const member = interaction.member;
  if (!(member instanceof GuildMember)) {
    await replyPrivately(interaction, "Roles can only be picked inside the server.", log, actor);
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
    log.warn("selection.rejected", actor, `Component type mismatch on ${group.label}`);
    await replyPrivately(interaction, staleNotice, log, actor);
    return;
  }

  if (plan.rejection !== undefined) {
    log.warn("selection.rejected", actor, `${group.label}: ${stripMarkdown(plan.rejection)}`);
    await replyPrivately(interaction, plan.rejection, log, actor);
    return;
  }

  if (plan.add.length === 0 && plan.remove.length === 0) {
    log.debug("selection.noop", actor, `${group.label}: no change`);
  }

  try {
    await applyPlan(member, plan, group);
  } catch (error) {
    await replyPrivately(interaction, explainFailure(error, group, actor, log), log, actor);
    return;
  }

  if (plan.add.length > 0 || plan.remove.length > 0) {
    log.info("selection.applied", actor, describeChange(group, plan, currentRoleIds));
  }

  await replyPrivately(
    interaction,
    describePlanWithState(group, plan, currentRoleIds),
    log,
    actor,
  );
}

/** `Combat Role: +Healer -Tank → Healer, DPS` */
function describeChange(
  group: ResolvedGroup,
  plan: SelectionPlan,
  currentRoleIds: readonly string[],
): string {
  const labelOf = (roleId: string): string =>
    group.roles.find((role) => role.discordRoleId === roleId)?.label ?? roleId;

  const changes = [
    ...plan.add.map((roleId) => `+${labelOf(roleId)}`),
    ...plan.remove.map((roleId) => `-${labelOf(roleId)}`),
  ].join(" ");

  const after = heldRoles(group, rolesAfterPlan(currentRoleIds, plan));
  const now = after.length === 0 ? "none" : after.map((role) => role.label).join(", ");

  return `${group.label}: ${changes} → ${now}`;
}

/** Member-facing text is written for Discord; the log file wants it plain. */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, "");
}

async function applyPlan(
  member: GuildMember,
  plan: SelectionPlan,
  group: ResolvedGroup,
): Promise<void> {
  if (plan.add.length === 0 && plan.remove.length === 0) return;

  // One edit rather than add-then-remove: a member never sits in a state the
  // group's own rules forbid, and it costs a single rate-limited call.
  const next = new Set(member.roles.cache.map((role) => role.id));
  for (const roleId of plan.remove) next.delete(roleId);
  for (const roleId of plan.add) next.add(roleId);

  await member.roles.set([...next], `Role picker: ${group.key}`);
}

function explainFailure(
  error: unknown,
  group: ResolvedGroup,
  actor: Actor,
  log: Logger,
): string {
  if (error instanceof DiscordAPIError && error.code === 50013) {
    log.error(
      "permission.denied",
      actor,
      `Cannot change ${group.label} roles — the bot's role sits below them`,
    );
    return `I don't have permission to change your **${group.label}** roles. An admin needs to move my role above them in Server Settings -> Roles.`;
  }
  log.error("error.unhandled", actor, `Failed to apply ${group.label}: ${describeError(error)}`);
  return "Something went wrong applying that. Try again, and ping an admin if it keeps failing.";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function replyPrivately(
  interaction: RepliableInteraction,
  content: string,
  log: Logger,
  actor: Actor,
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
    log.warn("error.unhandled", actor, `Could not reply to interaction: ${describeError(error)}`);
  }
}
