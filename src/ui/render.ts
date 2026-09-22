import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import {
  DEFAULT_EMBED_COLOR,
  DISCORD_LIMITS,
  hexToInt,
  resolveDisplay,
  resolveMaxSelections,
  type ResolvedGroup,
  type RoleButtonStyle,
} from "../config/types.js";
import { buttonId, menuId } from "./customId.js";

/**
 * Narrow enough to pass to both `channel.send` and `message.edit`, which do not
 * share a payload type.
 */
export interface PickerMessagePayload {
  embeds: EmbedBuilder[];
  components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[];
}

const BUTTON_STYLES: Record<RoleButtonStyle, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const DEFAULT_FOOTER = "Only you can see your changes.";

/**
 * One group renders as one message, so adding a group later posts a new message
 * and leaves the existing ones — and everyone's scroll position — alone.
 */
export function renderGroup(group: ResolvedGroup): PickerMessagePayload {
  const embed = new EmbedBuilder()
    .setTitle(group.label)
    .setDescription(bodyText(group))
    .setColor(hexToInt(group.color ?? DEFAULT_EMBED_COLOR))
    .setFooter({ text: group.footer ?? DEFAULT_FOOTER });

  if (group.thumbnail !== undefined) embed.setThumbnail(group.thumbnail);

  return {
    embeds: [embed],
    components:
      resolveDisplay(group) === "dropdown" ? [menuRow(group)] : buttonRows(group),
  };
}

/** Spells out the group's rule so members are not left guessing. */
export function rulesLine(group: ResolvedGroup): string {
  const max = resolveMaxSelections(group);
  const required = group.required === true;
  const verb = resolveDisplay(group) === "dropdown" ? "Choose" : "Click to toggle";

  if (max === 1) {
    return required ? `${verb} — one required.` : `${verb} — one only.`;
  }
  if (max >= group.roles.length) {
    return required ? `${verb} — as many as apply, at least one.` : `${verb} — as many as apply.`;
  }
  return required ? `${verb} — up to ${max}, at least one.` : `${verb} — up to ${max}.`;
}

/**
 * Group description, the rule, and the per-role descriptions.
 *
 * Buttons have no room for a role description, so in button mode they are
 * listed here instead of being dropped.
 */
function bodyText(group: ResolvedGroup): string {
  const parts = [group.description, rulesLine(group)].filter(Boolean) as string[];

  if (resolveDisplay(group) === "buttons") {
    const described = group.roles.filter((role) => role.description !== undefined);
    if (described.length > 0) {
      parts.push(
        described
          .map((role) => `${role.emoji ?? "•"} **${role.label}** — ${role.description}`)
          .join("\n"),
      );
    }
  }

  return parts.join("\n\n");
}

function buttonRows(group: ResolvedGroup): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = group.roles.map((role) => {
    const button = new ButtonBuilder()
      .setCustomId(buttonId(group.key, role.key))
      .setLabel(role.label)
      .setStyle(BUTTON_STYLES[role.style ?? "secondary"]);
    if (role.emoji !== undefined) button.setEmoji(role.emoji);
    return button;
  });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += DISCORD_LIMITS.buttonsPerRow) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buttons.slice(i, i + DISCORD_LIMITS.buttonsPerRow),
      ),
    );
  }
  return rows;
}

function menuRow(group: ResolvedGroup): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = group.roles.map((role) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(role.label)
      .setValue(role.key);
    if (role.description !== undefined) option.setDescription(role.description);
    if (role.emoji !== undefined) option.setEmoji(role.emoji);
    return option;
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(menuId(group.key))
    .setPlaceholder(`Choose your ${group.label.toLowerCase()}`)
    .setMinValues(group.required === true ? 1 : 0)
    .setMaxValues(Math.min(resolveMaxSelections(group), options.length))
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
