import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  Logger,
  SYSTEM_ACTOR,
  adminActor,
  formatActor,
  formatRecord,
  formatTimestamp,
  memberActor,
  shouldLog,
} from "./logger.js";

describe("formatActor", () => {
  it("names a member with their id", () => {
    assert.equal(formatActor(memberActor("240814000000000000", "Zak")), "member:Zak(240814000000000000)");
  });

  it("distinguishes an admin", () => {
    assert.equal(formatActor(adminActor("1", "Zak")), "admin:Zak(1)");
  });

  it("renders the bot's own actions as plain system", () => {
    assert.equal(formatActor(SYSTEM_ACTOR), "system");
  });

  it("falls back when a name is missing", () => {
    assert.equal(formatActor({ type: "member", id: "5" }), "member:unknown(5)");
  });
});

describe("formatTimestamp", () => {
  it("pads every component to a fixed width", () => {
    // Local-time constructor, matching the local-time formatter.
    const date = new Date(2026, 0, 2, 3, 4, 5, 6);
    assert.equal(formatTimestamp(date), "2026-01-02 03:04:05.006");
  });
});

describe("formatRecord", () => {
  const record = {
    timestamp: new Date(2026, 8, 22, 14, 3, 12, 482),
    level: "info" as const,
    event: "selection.applied" as const,
    actor: memberActor("240814", "Zak"),
    message: "Combat Role: +Healer → Tank, Healer",
  };

  it("lays the five fields out in order", () => {
    assert.equal(
      formatRecord(record),
      "2026-09-22 14:03:12.482  INFO   selection.applied   member:Zak(240814)                      Combat Role: +Healer → Tank, Healer",
    );
  });

  it("keeps the message column aligned for a real 18-digit Discord ID", () => {
    const realistic = formatRecord({ ...record, actor: memberActor("240814000000000000", "zakaria") });
    const short = formatRecord(record);
    assert.equal(
      realistic.indexOf("Combat Role"),
      short.indexOf("Combat Role"),
      "a full-length Discord ID must not push the message column out",
    );
  });

  it("never truncates an id, even if it overflows the column", () => {
    const line = formatRecord({
      ...record,
      actor: memberActor("240814000000000000", "a-very-long-discord-username"),
    });
    assert.ok(line.includes("240814000000000000"));
  });

  it("keeps the event greppable as a whole word", () => {
    assert.ok(formatRecord(record).includes("selection.applied"));
  });

  it("upper-cases the level", () => {
    assert.ok(formatRecord({ ...record, level: "error" }).includes("ERROR"));
  });

  it("does not truncate a long message", () => {
    const long = "x".repeat(500);
    assert.ok(formatRecord({ ...record, message: long }).endsWith(long));
  });
});

describe("shouldLog", () => {
  it("keeps entries at or above the configured level", () => {
    assert.equal(shouldLog("info", "info"), true);
    assert.equal(shouldLog("info", "warn"), true);
    assert.equal(shouldLog("info", "error"), true);
  });

  it("drops quieter entries", () => {
    assert.equal(shouldLog("info", "debug"), false);
    assert.equal(shouldLog("error", "warn"), false);
  });

  it("lets debug through everything", () => {
    assert.equal(shouldLog("debug", "debug"), true);
  });
});

describe("Logger — file output", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rolepicker-log-"));
    file = join(dir, "rolepicker.log");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes an entry to the file", async () => {
    const logger = new Logger({ level: "info", filePath: file, maxBytes: 1024, maxFiles: 2, console: false });
    logger.info("bot.ready", SYSTEM_ACTOR, "Logged in");
    await logger.flush();

    const contents = await readFile(file, "utf8");
    assert.ok(contents.includes("bot.ready"));
    assert.ok(contents.includes("Logged in"));
    assert.ok(contents.endsWith("\n"));
  });

  it("creates the directory if it does not exist", async () => {
    const nested = join(dir, "deeper", "still", "rolepicker.log");
    const logger = new Logger({ level: "info", filePath: nested, maxBytes: 1024, maxFiles: 2, console: false });
    logger.info("bot.ready", SYSTEM_ACTOR, "Logged in");
    await logger.flush();

    assert.ok((await readFile(nested, "utf8")).includes("bot.ready"));
  });

  it("filters by level before writing", async () => {
    const logger = new Logger({ level: "warn", filePath: file, maxBytes: 1024, maxFiles: 2, console: false });
    logger.info("bot.ready", SYSTEM_ACTOR, "should not appear");
    logger.error("setup.failed", SYSTEM_ACTOR, "should appear");
    await logger.flush();

    const contents = await readFile(file, "utf8");
    assert.ok(!contents.includes("should not appear"));
    assert.ok(contents.includes("should appear"));
  });

  it("keeps entries in order despite not being awaited", async () => {
    const logger = new Logger({ level: "info", filePath: file, maxBytes: 10_000, maxFiles: 2, console: false });
    for (let i = 0; i < 20; i++) logger.info("command.invoked", SYSTEM_ACTOR, `entry-${i}`);
    await logger.flush();

    const lines = (await readFile(file, "utf8")).trim().split("\n");
    assert.equal(lines.length, 20);
    lines.forEach((line, index) => assert.ok(line.endsWith(`entry-${index}`)));
  });

  it("rotates once the file passes maxBytes", async () => {
    const logger = new Logger({ level: "info", filePath: file, maxBytes: 300, maxFiles: 3, console: false });
    for (let i = 0; i < 20; i++) logger.info("command.invoked", SYSTEM_ACTOR, `entry-${i}`);
    await logger.flush();

    const files = (await readdir(dir)).sort();
    assert.ok(files.includes("rolepicker.log"), "the live file should exist");
    assert.ok(files.includes("rolepicker.log.1"), "a rotated file should exist");
  });

  it("keeps at most maxFiles rotated files", async () => {
    const logger = new Logger({ level: "info", filePath: file, maxBytes: 200, maxFiles: 2, console: false });
    for (let i = 0; i < 60; i++) logger.info("command.invoked", SYSTEM_ACTOR, `entry-${i}`);
    await logger.flush();

    const rotated = (await readdir(dir)).filter((name) => /\.\d+$/.test(name));
    assert.ok(rotated.length <= 2, `expected at most 2 rotated files, got ${rotated.join(", ")}`);
  });

  it("keeps the most recent entries in the live file after rotating", async () => {
    const logger = new Logger({ level: "info", filePath: file, maxBytes: 250, maxFiles: 3, console: false });
    for (let i = 0; i < 30; i++) logger.info("command.invoked", SYSTEM_ACTOR, `entry-${i}`);
    await logger.flush();

    assert.ok((await readFile(file, "utf8")).includes("entry-29"));
  });

  it("does not throw when the path cannot be written", async () => {
    // A directory where a file should be: writes fail, logging must not.
    const logger = new Logger({ level: "info", filePath: dir, maxBytes: 1024, maxFiles: 2, console: false });
    logger.info("bot.ready", SYSTEM_ACTOR, "still fine");
    await assert.doesNotReject(() => logger.flush());
  });

  it("writes nothing to disk when no filePath is set", async () => {
    const logger = new Logger({ level: "info", maxBytes: 1024, maxFiles: 2, console: false });
    logger.info("bot.ready", SYSTEM_ACTOR, "console only");
    await logger.flush();

    assert.deepEqual(await readdir(dir), []);
  });
});
