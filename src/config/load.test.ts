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
    // Distinct labels, same ID — otherwise the name-uniqueness rule fires first.
    const second = {
      ...first,
      key: "other",
      roles: [{ key: "tank", label: "Protector", discordRoleId: "000000000000000011" }],
    };
    assert.throws(() => validateConfig(config({ groups: [first, second] })), /only belong to one group/);
  });

  it("rejects two roles sharing a label, since unlinked roles match by name", () => {
    const first = (config()["groups"] as Record<string, unknown>[])[0]!;
    const second = {
      ...first,
      key: "other",
      roles: [{ key: "tank2", label: "Tank", discordRoleId: "000000000000000099" }],
    };
    assert.throws(() => validateConfig(config({ groups: [first, second] })), /Role names must be unique/);
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

describe("validateConfig — roles the bot creates", () => {
  it("accepts a role with no discordRoleId", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["roles"] = [{ key: "dps", label: "DPS" }];
    const parsed = validateConfig(config({ groups: [group] }));
    assert.equal(parsed.groups[0]?.roles[0]?.discordRoleId, undefined);
    assert.equal(parsed.groups[0]?.roles[0]?.label, "DPS");
  });

  it("still rejects a malformed discordRoleId when one is given", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["roles"] = [{ key: "dps", label: "DPS", discordRoleId: "not-an-id" }];
    assert.throws(() => validateConfig(config({ groups: [group] })), /17-20 digits/);
  });

  it("accepts hoist and a role colour", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["roles"] = [{ key: "dps", label: "DPS", hoist: true, color: "#c41e3a" }];
    const parsed = validateConfig(config({ groups: [group] }));
    assert.equal(parsed.groups[0]?.roles[0]?.hoist, true);
    assert.equal(parsed.groups[0]?.roles[0]?.color, "#c41e3a");
  });
});

describe("validateConfig — presentation fields", () => {
  it("accepts group colour, footer and thumbnail", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["color"] = "#5865F2";
    group["footer"] = "Pick away";
    group["thumbnail"] = "https://example.com/tank.png";
    const parsed = validateConfig(config({ groups: [group] }));
    assert.equal(parsed.groups[0]?.color, "#5865F2");
    assert.equal(parsed.groups[0]?.footer, "Pick away");
    assert.equal(parsed.groups[0]?.thumbnail, "https://example.com/tank.png");
  });

  it("rejects a colour that is not a hex triplet", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["color"] = "red";
    assert.throws(() => validateConfig(config({ groups: [group] })), /hex colour/);
  });

  it("rejects a thumbnail that is not an http URL", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["thumbnail"] = "tank.png";
    assert.throws(() => validateConfig(config({ groups: [group] })), /http\(s\) URL/);
  });

  it("accepts every button style", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["roles"] = [
      { key: "a", label: "A", style: "primary" },
      { key: "b", label: "B", style: "secondary" },
      { key: "c", label: "C", style: "success" },
      { key: "d", label: "D", style: "danger" },
    ];
    const parsed = validateConfig(config({ groups: [group] }));
    assert.deepEqual(
      parsed.groups[0]?.roles.map((role) => role.style),
      ["primary", "secondary", "success", "danger"],
    );
  });

  it("rejects an unknown button style", () => {
    const group = (config()["groups"] as Record<string, unknown>[])[0]!;
    group["roles"] = [{ key: "a", label: "A", style: "rainbow" }];
    assert.throws(() => validateConfig(config({ groups: [group] })), /style must be one of/);
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
