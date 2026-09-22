import { resolveMaxSelections, type ResolvedGroup, type ResolvedRole } from "../config/types.js";

/**
 * What a click should do to a member's roles.
 *
 * This module is pure: it takes the roles a member currently holds and what
 * they clicked, and returns the change to apply. No discord.js, no network, so
 * the group rules are testable on their own.
 */
export interface SelectionPlan {
  /** Discord role IDs to grant. */
  add: string[];
  /** Discord role IDs to take away. */
  remove: string[];
  /**
   * Set when the click was refused. `add`/`remove` are empty and the member is
   * told why.
   */
  rejection?: string;
}

const NO_CHANGE: SelectionPlan = { add: [], remove: [] };

function reject(reason: string): SelectionPlan {
  return { add: [], remove: [], rejection: reason };
}

/** The roles of this group the member currently holds, in config order. */
export function heldRoles(group: ResolvedGroup, currentRoleIds: Iterable<string>): ResolvedRole[] {
  const current = new Set(currentRoleIds);
  return group.roles.filter((role) => current.has(role.discordRoleId));
}

/**
 * The roles a member holds once a plan is applied. Used to show their resulting
 * picks without waiting for Discord to report the change back.
 */
export function rolesAfterPlan(
  currentRoleIds: Iterable<string>,
  plan: SelectionPlan,
): Set<string> {
  const next = new Set(currentRoleIds);
  for (const roleId of plan.remove) next.delete(roleId);
  for (const roleId of plan.add) next.add(roleId);
  return next;
}

/**
 * A button click, which carries toggle intent: the member is asking for one
 * role to go on or come off.
 *
 * - Already held -> take it off, unless the group is required and it is their last.
 * - Not held, and there is room -> put it on.
 * - Not held, and the group is full:
 *   - cap of 1 -> swap, because "Horde" can only mean "not Alliance".
 *   - cap of 2+ -> refuse, because which of the others to drop is a guess.
 *     The member is told to remove one first.
 */
export function planButtonClick(
  group: ResolvedGroup,
  currentRoleIds: Iterable<string>,
  clickedRoleKey: string,
): SelectionPlan {
  const clicked = group.roles.find((role) => role.key === clickedRoleKey);
  if (clicked === undefined) {
    return reject("That option is no longer available. An admin may have just changed the roles.");
  }

  const held = heldRoles(group, currentRoleIds);
  const isHeld = held.some((role) => role.key === clicked.key);

  if (isHeld) {
    if (group.required === true && held.length === 1) {
      return reject(`**${group.label}** is required, so you can't remove your last pick here.`);
    }
    return { add: [], remove: [clicked.discordRoleId] };
  }

  const max = resolveMaxSelections(group);
  if (held.length < max) {
    return { add: [clicked.discordRoleId], remove: [] };
  }

  if (max === 1) {
    return {
      add: [clicked.discordRoleId],
      remove: held.map((role) => role.discordRoleId),
    };
  }

  return reject(
    `**${group.label}** allows at most ${max} picks. Remove one first, then choose **${clicked.label}**.`,
  );
}

/**
 * A select menu submission, which carries replace intent: the member is
 * declaring the exact set they want, so we diff against what they hold.
 */
export function planMenuSubmit(
  group: ResolvedGroup,
  currentRoleIds: Iterable<string>,
  selectedRoleKeys: readonly string[],
): SelectionPlan {
  const selected: ResolvedRole[] = [];
  for (const key of new Set(selectedRoleKeys)) {
    const role = group.roles.find((candidate) => candidate.key === key);
    if (role === undefined) {
      return reject("Some of those options are no longer available. Try again.");
    }
    selected.push(role);
  }

  const max = resolveMaxSelections(group);
  if (selected.length > max) {
    return reject(`**${group.label}** allows at most ${max} pick(s); you chose ${selected.length}.`);
  }

  if (group.required === true && selected.length === 0) {
    return reject(`**${group.label}** is required, so you need to keep at least one pick.`);
  }

  const held = heldRoles(group, currentRoleIds);
  const selectedIds = new Set(selected.map((role) => role.discordRoleId));
  const heldIds = new Set(held.map((role) => role.discordRoleId));

  const add = selected.filter((role) => !heldIds.has(role.discordRoleId));
  const remove = held.filter((role) => !selectedIds.has(role.discordRoleId));

  if (add.length === 0 && remove.length === 0) return NO_CHANGE;

  return {
    add: add.map((role) => role.discordRoleId),
    remove: remove.map((role) => role.discordRoleId),
  };
}

/**
 * Every role in the group, ticked or not — so a member can see their whole
 * standing in one line rather than inferring it from what just changed.
 */
export function formatGroupState(
  group: ResolvedGroup,
  roleIds: Iterable<string>,
): string {
  const held = new Set(roleIds);
  return group.roles
    .map((role) => `${held.has(role.discordRoleId) ? "✅" : "⬜"} ${role.label}`)
    .join(" · ");
}

/**
 * The member-facing confirmation.
 *
 * Exclusive groups take roles away that the member never asked to lose, so the
 * removal is always named rather than folded into a bare "Done".
 */
export function describePlan(group: ResolvedGroup, plan: SelectionPlan): string {
  if (plan.rejection !== undefined) return plan.rejection;

  const nameOf = (roleId: string): string =>
    group.roles.find((role) => role.discordRoleId === roleId)?.label ?? "a role";

  const added = plan.add.map(nameOf);
  const removed = plan.remove.map(nameOf);

  if (added.length === 0 && removed.length === 0) {
    return `No change — your **${group.label}** picks are already set.`;
  }
  if (added.length > 0 && removed.length > 0) {
    return `Set your **${group.label}** to ${list(added)} (removed ${list(removed)}).`;
  }
  if (added.length > 0) {
    return `Added ${list(added)} to your **${group.label}**.`;
  }
  return `Removed ${list(removed)} from your **${group.label}**.`;
}

/** The confirmation plus the member's resulting picks across the whole group. */
export function describePlanWithState(
  group: ResolvedGroup,
  plan: SelectionPlan,
  currentRoleIds: Iterable<string>,
): string {
  const summary = describePlan(group, plan);
  if (plan.rejection !== undefined) return summary;
  return `${summary}\nNow: ${formatGroupState(group, rolesAfterPlan(currentRoleIds, plan))}`;
}

function list(labels: string[]): string {
  const bold = labels.map((label) => `**${label}**`);
  if (bold.length <= 1) return bold[0] ?? "";
  return `${bold.slice(0, -1).join(", ")} and ${bold.at(-1)}`;
}
