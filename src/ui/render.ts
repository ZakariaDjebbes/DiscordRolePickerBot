import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import {
  DISCORD_LIMITS,
  resolveDisplay,
  resolveMaxSelections,
  type RoleGroup,
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

/**
 * One group renders as one message, so adding a group later posts a new message
 * and leaves the existing ones — and everyone's scroll position — alone.
 */
export function renderGroup(group: RoleGroup): PickerMessagePayload {
  const embed = new EmbedBuilder().setTitle(group.label).setDescription(bodyText(group));

  return {
    embeds: [embed],
    components:
      resolveDisplay(group) === "dropdown" ? [menuRow(group)] : buttonRows(group),
  };
}

/** Spells out the group's rule so members are not left guessing. */
export function rulesLine(group: RoleGroup): string {
  const max = resolveMaxSelections(group);
  const required = group.required === true;

  if (max === 1) {
    return required ? "Pick one — this one is required." : "Pick one.";
  }
  if (max >= group.roles.length) {
    return required
      ? "Pick as many as apply — at least one is required."
      : "Pick as many as apply.";
  }
  return required ? `Pick up to ${max} — at least one is required.` : `Pick up to ${max}.`;
}

function bodyText(group: RoleGroup): string {
  const action =
    resolveDisplay(group) === "dropdown"
      ? "Use the menu below; your choice replaces whatever you had."
      : "Click a button to add or remove it.";
  return [group.description, rulesLine(group), action].filter(Boolean).join("\n");
}

function buttonRows(group: RoleGroup): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = group.roles.map((role) => {
    const button = new ButtonBuilder()
      .setCustomId(buttonId(group.key, role.key))
      .setLabel(role.label)
      .setStyle(ButtonStyle.Secondary);
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

function menuRow(group: RoleGroup): ActionRowBuilder<StringSelectMenuBuilder> {
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
