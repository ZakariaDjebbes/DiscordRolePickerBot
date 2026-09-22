import { hexToInt, type ResolvedConfig, type ResolvedRole, type RolePickerConfig, type SelectableRole } from "../config/types.js";
import type { StateStore } from "../state/store.js";
import type { Guild } from "discord.js";

/**
 * How a config role was matched to a Discord role.
 *
 * `configured` is an explicit discordRoleId. `remembered` is an ID the bot
 * stored after creating or matching the role before, which is what makes the
 * link survive someone renaming the role in Discord. `matched` fell back to
 * the role's name, and `created` means the bot made it.
 */
export type ResolutionSource = "configured" | "remembered" | "matched" | "created";

export interface ResolvedEntry {
  groupKey: string;
  roleKey: string;
  label: string;
  discordRoleId: string;
  source: ResolutionSource;
}

export interface UnresolvedEntry {
  groupKey: string;
  roleKey: string;
  label: string;
  reason: string;
}

export interface ResolutionResult {
  /** Config with every resolvable role carrying a concrete Discord role ID. */
  config: ResolvedConfig;
  entries: ResolvedEntry[];
  unresolved: UnresolvedEntry[];
  /** Groups left with no usable roles, which cannot be rendered. */
  emptyGroupKeys: string[];
}

export interface ResolveOptions {
  /**
   * Whether missing roles may be created.
   *
   * False at startup: creating roles changes the server, so it happens only on
   * the explicit `/rolepicker setup`, never as a side effect of a restart.
   */
  create: boolean;
}

/**
 * Turns config roles into concrete Discord roles, creating what is missing.
 *
 * Resolution order per role, first hit wins:
 *   1. an explicit `discordRoleId` in the config
 *   2. an ID the bot remembered from a previous run
 *   3. a guild role whose name equals the role's label
 *   4. a newly created role (only when `create` is set)
 *
 * Steps 2-4 record the ID, so after the first resolution the link is by ID and
 * renaming the role in Discord no longer matters.
 */
export async function resolveRoles(
  guild: Guild,
  config: RolePickerConfig,
  store: StateStore,
  options: ResolveOptions,
): Promise<ResolutionResult> {
  // One fetch, so name matching sees roles created outside the cache's lifetime.
  await guild.roles.fetch();

  const entries: ResolvedEntry[] = [];
  const unresolved: UnresolvedEntry[] = [];
  const emptyGroupKeys: string[] = [];
  const groups: ResolvedConfig["groups"] = [];

  for (const group of config.groups) {
    const roles: ResolvedRole[] = [];

    for (const role of group.roles) {
      const outcome = await resolveRole(guild, group.key, role, store, options);

      if (outcome.kind === "resolved") {
        roles.push({ ...role, discordRoleId: outcome.discordRoleId });
        entries.push({
          groupKey: group.key,
          roleKey: role.key,
          label: role.label,
          discordRoleId: outcome.discordRoleId,
          source: outcome.source,
        });
      } else {
        unresolved.push({
          groupKey: group.key,
          roleKey: role.key,
          label: role.label,
          reason: outcome.reason,
        });
      }
    }

    // Discord rejects a message with an empty action row, so a group with no
    // usable roles is reported rather than rendered.
    if (roles.length === 0) {
      emptyGroupKeys.push(group.key);
      continue;
    }

    groups.push({ ...group, roles });
  }

  return { config: { channelId: config.channelId, groups }, entries, unresolved, emptyGroupKeys };
}

type RoleOutcome =
  | { kind: "resolved"; discordRoleId: string; source: ResolutionSource }
  | { kind: "unresolved"; reason: string };

async function resolveRole(
  guild: Guild,
  groupKey: string,
  role: SelectableRole,
  store: StateStore,
  options: ResolveOptions,
): Promise<RoleOutcome> {
  if (role.discordRoleId !== undefined) {
    return { kind: "resolved", discordRoleId: role.discordRoleId, source: "configured" };
  }

  const remembered = await store.getRoleId(groupKey, role.key);
  if (remembered !== undefined && guild.roles.cache.has(remembered)) {
    return { kind: "resolved", discordRoleId: remembered, source: "remembered" };
  }
  if (remembered !== undefined) {
    // The role was deleted in Discord. Forget it so we do not keep pointing at
    // an ID that no longer exists, then fall through to matching or creating.
    await store.forgetRole(groupKey, role.key);
  }

  const byName = guild.roles.cache.find((candidate) => candidate.name === role.label);
  if (byName !== undefined) {
    await store.setRoleId(groupKey, role.key, byName.id);
    return { kind: "resolved", discordRoleId: byName.id, source: "matched" };
  }

  if (!options.create) {
    return {
      kind: "unresolved",
      reason: `No role named "${role.label}" exists yet. Run /rolepicker setup to create it.`,
    };
  }

  try {
    const created = await guild.roles.create({
      name: role.label,
      // These are organisational labels. A role that silently carries
      // permissions would be a security problem, so it is explicitly empty.
      permissions: [],
      mentionable: false,
      hoist: role.hoist ?? false,
      ...(role.color !== undefined
        ? { colors: { primaryColor: hexToInt(role.color) } }
        : {}),
      reason: `Role picker: ${groupKey}/${role.key}`,
    });

    await store.setRoleId(groupKey, role.key, created.id);
    return { kind: "resolved", discordRoleId: created.id, source: "created" };
  } catch (error) {
    return {
      kind: "unresolved",
      reason: `Could not create "${role.label}": ${(error as Error).message}`,
    };
  }
}
