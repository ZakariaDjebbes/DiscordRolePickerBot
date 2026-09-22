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

/**
 * Button colour, as a Discord button style.
 *
 * On the shared picker message a colour means *which role this is*, never
 * "you have this one" — a shared message renders identically for every viewer,
 * so it cannot show per-member state. Anything that does show state (such as
 * an ephemeral panel) has to mark it some other way, e.g. a leading tick.
 */
export type RoleButtonStyle = "primary" | "secondary" | "success" | "danger";

export interface SelectableRole {
  /** Stable identifier used in component custom_ids. Never reuse a key. */
  key: string;
  /** What members see on the button or menu option, and the name of a created role. */
  label: string;
  /** Unicode emoji, or a custom emoji as `<:name:id>`. */
  emoji?: string;
  /** Shown beneath the label in dropdown mode, and in the embed body for buttons. */
  description?: string;
  /** Button colour. Defaults to `secondary`. */
  style?: RoleButtonStyle;
  /** Hex colour (`#RRGGBB`) applied to the Discord role when the bot creates it. */
  color?: string;
  /** Whether a created role is displayed separately in the member list. */
  hoist?: boolean;
  /**
   * The Discord role this grants.
   *
   * Optional. When it is left out the bot resolves the role at setup time —
   * reusing the one it created before, then one whose name matches `label`,
   * and creating it only if neither exists. See `src/bot/roleResolver.ts`.
   */
  discordRoleId?: string;
}

/** A role whose Discord ID is known, which is what the runtime works with. */
export interface ResolvedRole extends SelectableRole {
  discordRoleId: string;
}

export interface RoleGroup<TRole extends SelectableRole = SelectableRole> {
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
  /** Hex colour (`#RRGGBB`) for the embed's accent bar. */
  color?: string;
  /** Image URL shown as the embed thumbnail. */
  thumbnail?: string;
  /** Replaces the default embed footer. */
  footer?: string;
  roles: TRole[];
}

export type ResolvedGroup = RoleGroup<ResolvedRole>;

export interface RolePickerConfig<TRole extends SelectableRole = SelectableRole> {
  /** Channel the picker messages are posted to. */
  channelId: string;
  groups: RoleGroup<TRole>[];
}

export type ResolvedConfig = RolePickerConfig<ResolvedRole>;

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

/** The default embed accent when a group sets no `color`. */
export const DEFAULT_EMBED_COLOR = "#5865F2";

/**
 * The cap a group actually enforces, resolving `mode` and `maxSelections`.
 */
export function resolveMaxSelections(group: RoleGroup<SelectableRole>): number {
  if (group.maxSelections !== undefined) return group.maxSelections;
  return group.mode === "exclusive" ? 1 : group.roles.length;
}

/** Whether a group renders as buttons or as a select menu. */
export function resolveDisplay(group: RoleGroup<SelectableRole>): "buttons" | "dropdown" {
  const display = group.display ?? "auto";
  if (display !== "auto") return display;
  return group.roles.length > AUTO_DROPDOWN_THRESHOLD ? "dropdown" : "buttons";
}

/** `#rrggbb` -> the integer Discord expects. */
export function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}
