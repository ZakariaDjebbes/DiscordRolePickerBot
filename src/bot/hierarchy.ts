import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import type { RolePickerConfig } from "../config/types.js";

export interface HierarchyProblem {
  kind:
    | "missing-permission"
    | "missing-role"
    | "role-too-high"
    | "managed-role"
    | "missing-channel"
    | "wrong-channel-type"
    | "channel-permission";
  message: string;
}

/**
 * What the bot needs in the picker channel itself. Posting an embed needs
 * EmbedLinks on top of SendMessages, which is easy to miss.
 */
const REQUIRED_CHANNEL_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, name: "View Channel" },
  { flag: PermissionFlagsBits.SendMessages, name: "Send Messages" },
  { flag: PermissionFlagsBits.EmbedLinks, name: "Embed Links" },
] as const;

/**
 * Whether the bot can actually post in the configured channel.
 *
 * Separate from the role checks because it fails for a different reason:
 * channel permission overwrites override whatever the invite link granted, so
 * a bot with server-wide Send Messages can still be locked out of one channel.
 * Without this the failure surfaces as Discord's bare "Missing Permissions".
 */
export async function checkChannelAccess(
  guild: Guild,
  config: RolePickerConfig,
): Promise<HierarchyProblem[]> {
  const me = guild.members.me;
  if (me === null) return [];

  let channel;
  try {
    channel = await guild.channels.fetch(config.channelId);
  } catch {
    channel = null;
  }

  if (channel === null) {
    return [
      {
        kind: "missing-channel",
        message: `Channel ${config.channelId} does not exist in this server, or the bot cannot see it at all. Check channelId in the config, and give the bot "View Channel" on it.`,
      },
    ];
  }

  if (channel.type !== ChannelType.GuildText) {
    return [
      {
        kind: "wrong-channel-type",
        message: `Channel #${channel.name} is not a standard text channel, so the picker cannot be posted there.`,
      },
    ];
  }

  const permissions = channel.permissionsFor(me);
  if (permissions === null) {
    return [
      {
        kind: "channel-permission",
        message: `Could not read the bot's permissions in #${channel.name}.`,
      },
    ];
  }

  const missing = REQUIRED_CHANNEL_PERMISSIONS.filter(
    (permission) => !permissions.has(permission.flag),
  ).map((permission) => permission.name);

  if (missing.length === 0) return [];

  return [
    {
      kind: "channel-permission",
      message: `The bot is missing ${missing.join(", ")} in #${channel.name}. Right-click the channel -> Edit Channel -> Permissions, add the bot's role, and allow those. Channel overwrites beat the permissions from the invite link.`,
    },
  ];
}

/**
 * Everything that must hold before a picker can work: the bot can assign every
 * configured role, and it can post in the channel.
 */
export async function checkSetupReadiness(
  guild: Guild,
  config: RolePickerConfig,
): Promise<HierarchyProblem[]> {
  return [...checkHierarchy(guild, config), ...(await checkChannelAccess(guild, config))];
}

/**
 * The single most common reason this kind of bot "silently does nothing":
 * Discord refuses to let a bot grant a role positioned at or above its own
 * highest role. Checked at startup and before setup so it surfaces as a clear
 * message instead of a 403 on someone's first click.
 */
export function checkHierarchy(
  guild: Guild,
  config: RolePickerConfig,
): HierarchyProblem[] {
  const problems: HierarchyProblem[] = [];
  const me = guild.members.me;

  if (me === null) {
    return [
      {
        kind: "missing-permission",
        message: "The bot's own member record is not cached yet; try again in a moment.",
      },
    ];
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    problems.push({
      kind: "missing-permission",
      message:
        'The bot is missing the "Manage Roles" permission. Grant it in Server Settings -> Roles.',
    });
  }

  const botPosition = me.roles.highest.position;

  for (const group of config.groups) {
    for (const role of group.roles) {
      const guildRole = guild.roles.cache.get(role.discordRoleId);

      if (guildRole === undefined) {
        problems.push({
          kind: "missing-role",
          message: `Role ${role.discordRoleId} ("${role.label}" in group "${group.key}") does not exist in this server.`,
        });
        continue;
      }

      if (guildRole.managed) {
        problems.push({
          kind: "managed-role",
          message: `"${guildRole.name}" is managed by an integration and cannot be assigned by a bot. Use a normal role for "${role.label}".`,
        });
        continue;
      }

      if (guildRole.position >= botPosition) {
        problems.push({
          kind: "role-too-high",
          message: `"${guildRole.name}" sits at or above the bot's highest role, so the bot cannot assign it. Drag the bot's role above it in Server Settings -> Roles.`,
        });
      }
    }
  }

  return problems;
}
