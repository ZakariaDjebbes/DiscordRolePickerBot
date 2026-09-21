import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ConfigError, validateConfig } from "./load.js";
import { resolveDisplay, resolveMaxSelections } from "./types.js";

const CHANNEL = "000000000000000001";

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channelId: CHANNEL,
    groups: [
      {
        key: "combat-role",
        label: "Combat Role",
        mode: "multi",
        roles: [
          { key: "tank", label: "Tank", discordRoleId: "000000000000000011" },
          { key: "healer", label: "Healer", discordRoleId: "000000000000000012" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("validateConfig", () => {
  it("accepts a minimal config", () => {
    const parsed = validateConfig(config());
    assert.equal(parsed.groups.length, 1);
    assert.equal(parsed.groups[0]?.mode, "multi");
  });

  it("accepts the shipped example", async () => {
    const raw: unknown = JSON.parse(await readFile("config/roles.example.json", "utf8"));
    const parsed = validateConfig(raw);
    assert.equal(parsed.groups.length, 5);
    assert.equal(resolveMaxSelections(parsed.groups[4]!), 2);
  });

  it("rejects a non-snowflake channelId", () => {
    assert.throws(() => validateConfig(config({ channelId: "general" })), ConfigError);
  });

  it("rejects an unknown mode", () => {
    const bad = config();
    (bad["groups"] as Record<string, unknown>[])[0]!["mode"] = "pick-one";
    assert.throws(() => validateConfig(bad), /mode must be/);
  });

  it("rejects duplicate group keys", () => {
    const groups = (config()["groups"] as Record<string, unknown>[])[0]!;
    assert.throws(
      () => validateConfig(config({ groups: [groups, { ...groups }] })),
      /more than one group/,
    );
  });

  it("rejects the same Discord role in two groups", () => {
    const first = (config()["groups"] as Record<string, unknown>[])[0]!;
    const second = { ...first, key: "other", roles: first["roles"] };
    assert.throws(() => validateConfig(config({ groups: [first, second] })), /only belong to one group/);
  });

  it("rejects exclusive combined with maxSelections > 1", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["mode"] = "exclusive";
    group["maxSelections"] = 2;
    assert.throws(() => validateConfig(config({ groups: [group] })), /exclusive/);
  });

  it("rejects maxSelections larger than the group", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["maxSelections"] = 5;
    assert.throws(() => validateConfig(config({ groups: [group] })), /only holds 2/);
  });

  it("rejects a key with characters that break custom_ids", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["key"] = "combat:role";
    assert.throws(() => validateConfig(config({ groups: [group] })), /lowercase letters/);
  });

  it("rejects more roles than Discord can draw as buttons", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["display"] = "buttons";
    group["roles"] = Array.from({ length: 26 }, (_, i) => ({
      key: `r${i}`,
      label: `Role ${i}`,
      discordRoleId: `3000000000000000${String(i).padStart(2, "0")}`,
    }));
    assert.throws(() => validateConfig(config({ groups: [group] })), /at most 25/);
  });
});

describe("resolveDisplay", () => {
  it("draws small groups as buttons", () => {
    const parsed = validateConfig(config());
    assert.equal(resolveDisplay(parsed.groups[0]!), "buttons");
  });

  it("switches to a dropdown past the threshold", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["roles"] = Array.from({ length: 12 }, (_, i) => ({
      key: `lang-${i}`,
      label: `Language ${i}`,
      discordRoleId: `4000000000000000${String(i).padStart(2, "0")}`,
    }));
    const parsed = validateConfig(config({ groups: [group] }));
    assert.equal(resolveDisplay(parsed.groups[0]!), "dropdown");
  });

  it("honours an explicit override", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["display"] = "dropdown";
    const parsed = validateConfig(config({ groups: [group] }));
    assert.equal(resolveDisplay(parsed.groups[0]!), "dropdown");
  });
});
