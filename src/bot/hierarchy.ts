import { PermissionFlagsBits, type Guild } from "discord.js";
import type { RolePickerConfig } from "../config/types.js";

export interface HierarchyProblem {
  kind: "missing-permission" | "missing-role" | "role-too-high" | "managed-role";
  message: string;
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
