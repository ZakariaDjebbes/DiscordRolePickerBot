import { readFile } from "node:fs/promises";
import {
  DISCORD_LIMITS,
  resolveDisplay,
  resolveMaxSelections,
  type RoleButtonStyle,
  type RoleGroup,
  type RolePickerConfig,
  type SelectableRole,
} from "./types.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const SNOWFLAKE = /^\d{17,20}$/;
const KEY = /^[a-z0-9][a-z0-9-]*$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const BUTTON_STYLES: readonly RoleButtonStyle[] = ["primary", "secondary", "success", "danger"];

/**
 * Validates a parsed config and returns it typed.
 *
 * Every problem is reported against a path like `groups[1].roles[0].key` so a
 * typo in a 40-role language group is findable without counting brackets.
 */
export function validateConfig(raw: unknown): RolePickerConfig {
  if (!isRecord(raw)) throw new ConfigError("Config must be a JSON object.");

  const channelId = raw["channelId"];
  if (typeof channelId !== "string" || !SNOWFLAKE.test(channelId)) {
    throw new ConfigError(
      "channelId must be a Discord channel ID (17-20 digits). Enable Developer Mode in Discord, then right-click the channel -> Copy Channel ID.",
    );
  }

  const groups = raw["groups"];
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new ConfigError("groups must be a non-empty array.");
  }

  const seenGroupKeys = new Set<string>();
  const seenRoleIds = new Map<string, string>();
  const seenRoleLabels = new Map<string, string>();
  const validated: RoleGroup[] = [];

  groups.forEach((group, index) => {
    const path = `groups[${index}]`;
    validated.push(validateGroup(group, path, seenGroupKeys, seenRoleIds, seenRoleLabels));
  });

  return { channelId, groups: validated };
}

function validateGroup(
  raw: unknown,
  path: string,
  seenGroupKeys: Set<string>,
  seenRoleIds: Map<string, string>,
  seenRoleLabels: Map<string, string>,
): RoleGroup {
  if (!isRecord(raw)) throw new ConfigError(`${path} must be an object.`);

  const key = requireKey(raw["key"], `${path}.key`);
  if (seenGroupKeys.has(key)) {
    throw new ConfigError(`${path}.key "${key}" is used by more than one group.`);
  }
  seenGroupKeys.add(key);

  const label = requireString(raw["label"], `${path}.label`, 256);
  const description = optionalString(raw["description"], `${path}.description`, 2048);
  const footer = optionalString(raw["footer"], `${path}.footer`, 2048);
  const thumbnail = optionalUrl(raw["thumbnail"], `${path}.thumbnail`);
  const color = optionalHexColor(raw["color"], `${path}.color`);

  const mode = raw["mode"];
  if (mode !== "multi" && mode !== "exclusive") {
    throw new ConfigError(`${path}.mode must be "multi" or "exclusive".`);
  }

  const required = optionalBoolean(raw["required"], `${path}.required`);

  const display = raw["display"] ?? "auto";
  if (display !== "auto" && display !== "buttons" && display !== "dropdown") {
    throw new ConfigError(`${path}.display must be "auto", "buttons" or "dropdown".`);
  }

  const rawRoles = raw["roles"];
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    throw new ConfigError(`${path}.roles must be a non-empty array.`);
  }

  const seenRoleKeys = new Set<string>();
  const roles: SelectableRole[] = rawRoles.map((role, index) =>
    validateRole(
      role,
      `${path}.roles[${index}]`,
      key,
      seenRoleKeys,
      seenRoleIds,
      seenRoleLabels,
    ),
  );

  const maxSelections = raw["maxSelections"];
  let resolvedMax: number | undefined;
  if (maxSelections !== undefined) {
    if (typeof maxSelections !== "number" || !Number.isInteger(maxSelections) || maxSelections < 1) {
      throw new ConfigError(`${path}.maxSelections must be a whole number of at least 1.`);
    }
    if (mode === "exclusive" && maxSelections !== 1) {
      throw new ConfigError(
        `${path} is "exclusive" but sets maxSelections to ${maxSelections}. An exclusive group allows exactly one role — use mode "multi" with maxSelections instead.`,
      );
    }
    if (maxSelections > roles.length) {
      throw new ConfigError(
        `${path}.maxSelections is ${maxSelections} but the group only holds ${roles.length} role(s).`,
      );
    }
    resolvedMax = maxSelections;
  }

  const group: RoleGroup = {
    key,
    label,
    mode,
    roles,
    ...(description !== undefined ? { description } : {}),
    ...(footer !== undefined ? { footer } : {}),
    ...(thumbnail !== undefined ? { thumbnail } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(resolvedMax !== undefined ? { maxSelections: resolvedMax } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(display !== "auto" ? { display } : {}),
  };

  // A required group nobody can satisfy is a config bug, not a runtime one.
  if (required === true && resolveMaxSelections(group) < 1) {
    throw new ConfigError(`${path} is required but allows no selections.`);
  }

  const limit =
    resolveDisplay(group) === "dropdown"
      ? DISCORD_LIMITS.maxSelectOptions
      : DISCORD_LIMITS.maxButtonsPerMessage;
  if (roles.length > limit) {
    throw new ConfigError(
      `${path} has ${roles.length} roles but Discord allows at most ${limit} in a ${resolveDisplay(group)} message. Split it into two groups.`,
    );
  }

  return group;
}

function validateRole(
  raw: unknown,
  path: string,
  groupKey: string,
  seenRoleKeys: Set<string>,
  seenRoleIds: Map<string, string>,
  seenRoleLabels: Map<string, string>,
): SelectableRole {
  if (!isRecord(raw)) throw new ConfigError(`${path} must be an object.`);

  const key = requireKey(raw["key"], `${path}.key`);
  if (seenRoleKeys.has(key)) {
    throw new ConfigError(`${path}.key "${key}" is used twice in group "${groupKey}".`);
  }
  seenRoleKeys.add(key);

  const label = requireString(raw["label"], `${path}.label`, 80);
  const emoji = optionalString(raw["emoji"], `${path}.emoji`, 64);
  const description = optionalString(raw["description"], `${path}.description`, 100);
  const color = optionalHexColor(raw["color"], `${path}.color`);
  const hoist = optionalBoolean(raw["hoist"], `${path}.hoist`);

  const rawStyle = raw["style"];
  let style: RoleButtonStyle | undefined;
  if (rawStyle !== undefined) {
    if (typeof rawStyle !== "string" || !BUTTON_STYLES.includes(rawStyle as RoleButtonStyle)) {
      throw new ConfigError(`${path}.style must be one of ${BUTTON_STYLES.join(", ")}.`);
    }
    style = rawStyle as RoleButtonStyle;
  }

  // Roles the bot will resolve or create are matched by label, so two roles
  // sharing a name would race for the same Discord role.
  const labelOwner = seenRoleLabels.get(label.toLowerCase());
  if (labelOwner !== undefined) {
    throw new ConfigError(
      `${path}.label "${label}" is already used by group "${labelOwner}". Role names must be unique, because roles without a discordRoleId are matched to Discord by name.`,
    );
  }
  seenRoleLabels.set(label.toLowerCase(), groupKey);

  const rawRoleId = raw["discordRoleId"];
  let discordRoleId: string | undefined;
  if (rawRoleId !== undefined) {
    if (typeof rawRoleId !== "string" || !SNOWFLAKE.test(rawRoleId)) {
      throw new ConfigError(
        `${path}.discordRoleId must be a Discord role ID (17-20 digits), or left out entirely so the bot creates the role. Server Settings -> Roles -> right-click the role -> Copy Role ID.`,
      );
    }

    // The same Discord role in two groups means one group's rules can silently
    // undo the other's. Catch it here rather than in a confused bug report.
    const owner = seenRoleIds.get(rawRoleId);
    if (owner !== undefined) {
      throw new ConfigError(
        `${path}.discordRoleId ${rawRoleId} is already used by group "${owner}". A Discord role may only belong to one group.`,
      );
    }
    seenRoleIds.set(rawRoleId, groupKey);
    discordRoleId = rawRoleId;
  }

  return {
    key,
    label,
    ...(discordRoleId !== undefined ? { discordRoleId } : {}),
    ...(emoji !== undefined ? { emoji } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(hoist !== undefined ? { hoist } : {}),
  };
}

export async function loadConfig(path: string): Promise<RolePickerConfig> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new ConfigError(
      `Could not read the role config at ${path}. Copy config/roles.example.json to that path and fill in your IDs. (${(error as Error).message})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }

  return validateConfig(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${path} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new ConfigError(`${path} must be at most ${maxLength} characters (Discord's limit).`);
  }
  return value;
}

function requireKey(value: unknown, path: string): string {
  // 32 keeps `rolepicker:btn:<group>:<role>` inside Discord's 100-char custom_id.
  const key = requireString(value, path, 32);
  if (!KEY.test(key)) {
    throw new ConfigError(
      `${path} must be lowercase letters, digits and hyphens only (e.g. "combat-role"), got "${key}".`,
    );
  }
  return key;
}

function optionalString(value: unknown, path: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path, maxLength);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ConfigError(`${path} must be true or false.`);
  return value;
}

function optionalHexColor(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  const color = requireString(value, path, 7);
  if (!HEX_COLOR.test(color)) {
    throw new ConfigError(`${path} must be a hex colour like "#c41e3a", got "${color}".`);
  }
  return color;
}

function optionalUrl(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  const url = requireString(value, path, 2048);
  if (!/^https?:\/\//.test(url)) {
    throw new ConfigError(`${path} must be an http(s) URL, got "${url}".`);
  }
  return url;
}
