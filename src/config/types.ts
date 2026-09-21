/**
 * Shape of the role picker configuration.
 *
 * Everything the bot offers is data: adding "Ranged DPS" or a whole new
 * "Languages" group is a config edit plus a `/rolepicker setup`, never a code
 * change.
 */

/** How many roles a member may hold at once within one group. */
export type GroupMode = "multi" | "exclusive";

/** How a group is drawn in the channel. */
export type GroupDisplay = "buttons" | "dropdown" | "auto";

export interface SelectableRole {
  /** Stable identifier used in component custom_ids. Never reuse a key. */
  key: string;
  /** What members see on the button or menu option. */
  label: string;
  /** Unicode emoji, or a custom emoji as `<:name:id>`. */
  emoji?: string;
  /** Shown under the label in dropdown mode only; Discord has no room for it on a button. */
  description?: string;
  /** The Discord role this grants. Right-click the role -> Copy Role ID. */
  discordRoleId: string;
}

export interface RoleGroup {
  /** Stable identifier used in component custom_ids and in the state file. */
  key: string;
  /** Embed title, e.g. "Combat Role". */
  label: string;
  /** Embed body, e.g. "What you play in raids." */
  description?: string;
  /**
   * `multi` lets a member hold every role in the group at once (Tank + Healer
   * for a hybrid). `exclusive` allows exactly one (Alliance or Horde).
   *
   * Both are sugar over {@link RoleGroup.maxSelections}: `exclusive` is a max
   * of 1, `multi` a max of however many roles the group holds. Set
   * `maxSelections` directly for anything in between, such as "pick up to two
   * specs".
   */
  mode: GroupMode;
  /** Overrides the cap implied by `mode`. Must be >= 1. */
  maxSelections?: number;
  /** When true, a member may not drop their last role in this group. */
  required?: boolean;
  /** `auto` draws buttons for small groups and a dropdown for large ones. */
  display?: GroupDisplay;
  roles: SelectableRole[];
}

export interface RolePickerConfig {
  /** Channel the picker messages are posted to. */
  channelId: string;
  groups: RoleGroup[];
}

/** Discord's hard caps, not ours. */
export const DISCORD_LIMITS = {
  /** 5 buttons per action row, 5 rows per message. */
  maxButtonsPerMessage: 25,
  /** A string select menu holds at most 25 options. */
  maxSelectOptions: 25,
  buttonsPerRow: 5,
} as const;

/** Above this many roles, an `auto` group is drawn as a dropdown. */
export const AUTO_DROPDOWN_THRESHOLD = 8;

/**
 * The cap a group actually enforces, resolving `mode` and `maxSelections`.
 */
export function resolveMaxSelections(group: RoleGroup): number {
  if (group.maxSelections !== undefined) return group.maxSelections;
  return group.mode === "exclusive" ? 1 : group.roles.length;
}

/** Whether a group renders as buttons or as a select menu. */
export function resolveDisplay(group: RoleGroup): "buttons" | "dropdown" {
  const display = group.display ?? "auto";
  if (display !== "auto") return display;
  return group.roles.length > AUTO_DROPDOWN_THRESHOLD ? "dropdown" : "buttons";
}
