import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoleGroup } from "../config/types.js";
import { describePlan, planButtonClick, planMenuSubmit } from "./selection.js";

const TANK = "100000000000000001";
const HEALER = "100000000000000002";
const DPS = "100000000000000003";
const ALLIANCE = "200000000000000001";
const HORDE = "200000000000000002";

const combat: RoleGroup = {
  key: "combat-role",
  label: "Combat Role",
  mode: "multi",
  roles: [
    { key: "tank", label: "Tank", discordRoleId: TANK },
    { key: "healer", label: "Healer", discordRoleId: HEALER },
    { key: "dps", label: "DPS", discordRoleId: DPS },
  ],
};

const faction: RoleGroup = {
  key: "faction",
  label: "Faction",
  mode: "exclusive",
  roles: [
    { key: "alliance", label: "Alliance", discordRoleId: ALLIANCE },
    { key: "horde", label: "Horde", discordRoleId: HORDE },
  ],
};

describe("planButtonClick — multi groups", () => {
  it("adds a role the member does not hold", () => {
    const plan = planButtonClick(combat, [], "tank");
    assert.deepEqual(plan.add, [TANK]);
    assert.deepEqual(plan.remove, []);
  });

  it("lets a hybrid hold Tank and Healer at once", () => {
    const plan = planButtonClick(combat, [TANK], "healer");
    assert.deepEqual(plan.add, [HEALER]);
    assert.deepEqual(plan.remove, []);
  });

  it("toggles a held role back off", () => {
    const plan = planButtonClick(combat, [TANK, HEALER], "tank");
    assert.deepEqual(plan.add, []);
    assert.deepEqual(plan.remove, [TANK]);
  });

  it("ignores roles from other groups that the member holds", () => {
    const plan = planButtonClick(combat, [ALLIANCE, HORDE], "dps");
    assert.deepEqual(plan.add, [DPS]);
    assert.deepEqual(plan.remove, []);
  });
});

describe("planButtonClick — exclusive groups", () => {
  it("swaps the held role for the clicked one", () => {
    const plan = planButtonClick(faction, [ALLIANCE], "horde");
    assert.deepEqual(plan.add, [HORDE]);
    assert.deepEqual(plan.remove, [ALLIANCE]);
  });

  it("clears every other held role, even ones hand-assigned by a mod", () => {
    const plan = planButtonClick(faction, [ALLIANCE, HORDE], "horde");
    assert.deepEqual(plan.add, []);
    // Horde is held, so this is a plain toggle-off.
    assert.deepEqual(plan.remove, [HORDE]);
  });

  it("allows clearing the only pick when the group is optional", () => {
    const plan = planButtonClick(faction, [HORDE], "horde");
    assert.deepEqual(plan.remove, [HORDE]);
    assert.equal(plan.rejection, undefined);
  });

  it("refuses to clear the last pick when the group is required", () => {
    const required: RoleGroup = { ...faction, required: true };
    const plan = planButtonClick(required, [HORDE], "horde");
    assert.ok(plan.rejection?.includes("required"));
    assert.deepEqual(plan.add, []);
    assert.deepEqual(plan.remove, []);
  });

  it("still swaps in a required group", () => {
    const required: RoleGroup = { ...faction, required: true };
    const plan = planButtonClick(required, [ALLIANCE], "horde");
    assert.deepEqual(plan.add, [HORDE]);
    assert.deepEqual(plan.remove, [ALLIANCE]);
  });
});

describe("planButtonClick — capped groups", () => {
  const twoSpecs: RoleGroup = { ...combat, maxSelections: 2 };

  it("allows picks up to the cap", () => {
    const plan = planButtonClick(twoSpecs, [TANK], "healer");
    assert.deepEqual(plan.add, [HEALER]);
  });

  it("refuses past the cap instead of guessing which role to drop", () => {
    const plan = planButtonClick(twoSpecs, [TANK, HEALER], "dps");
    assert.ok(plan.rejection?.includes("at most 2"));
    assert.deepEqual(plan.add, []);
    assert.deepEqual(plan.remove, []);
  });

  it("still toggles off at the cap", () => {
    const plan = planButtonClick(twoSpecs, [TANK, HEALER], "tank");
    assert.deepEqual(plan.remove, [TANK]);
  });
});

describe("planButtonClick — unknown roles", () => {
  it("rejects a key that is no longer in the config", () => {
    const plan = planButtonClick(combat, [], "bard");
    assert.ok(plan.rejection);
    assert.deepEqual(plan.add, []);
  });
});

describe("planMenuSubmit", () => {
  it("diffs the chosen set against what is held", () => {
    const plan = planMenuSubmit(combat, [TANK, HEALER], ["healer", "dps"]);
    assert.deepEqual(plan.add, [DPS]);
    assert.deepEqual(plan.remove, [TANK]);
  });

  it("clears everything when nothing is chosen", () => {
    const plan = planMenuSubmit(combat, [TANK, DPS], []);
    assert.deepEqual(plan.add, []);
    assert.deepEqual(plan.remove, [TANK, DPS]);
  });

  it("reports no change when the selection already matches", () => {
    const plan = planMenuSubmit(combat, [TANK], ["tank"]);
    assert.deepEqual(plan.add, []);
    assert.deepEqual(plan.remove, []);
    assert.equal(describePlan(combat, plan), "No change — your **Combat Role** picks are already set.");
  });

  it("refuses an empty selection in a required group", () => {
    const plan = planMenuSubmit({ ...combat, required: true }, [TANK], []);
    assert.ok(plan.rejection?.includes("required"));
    assert.deepEqual(plan.remove, []);
  });

  it("refuses more picks than the cap", () => {
    const plan = planMenuSubmit({ ...combat, maxSelections: 2 }, [], ["tank", "healer", "dps"]);
    assert.ok(plan.rejection?.includes("at most 2"));
  });

  it("tolerates a duplicated key in the payload", () => {
    const plan = planMenuSubmit(combat, [], ["tank", "tank"]);
    assert.deepEqual(plan.add, [TANK]);
  });
});

describe("describePlan", () => {
  it("names what an exclusive swap removed", () => {
    const plan = planButtonClick(faction, [ALLIANCE], "horde");
    assert.equal(
      describePlan(faction, plan),
      "Set your **Faction** to **Horde** (removed **Alliance**).",
    );
  });

  it("reads naturally for a plain add", () => {
    const plan = planButtonClick(combat, [], "tank");
    assert.equal(describePlan(combat, plan), "Added **Tank** to your **Combat Role**.");
  });

  it("joins several labels", () => {
    const plan = planMenuSubmit(combat, [], ["tank", "healer", "dps"]);
    assert.equal(
      describePlan(combat, plan),
      "Added **Tank**, **Healer** and **DPS** to your **Combat Role**.",
    );
  });

  it("passes a rejection straight through", () => {
    const plan = planButtonClick({ ...faction, required: true }, [HORDE], "horde");
    assert.equal(describePlan(faction, plan), plan.rejection);
  });
});
