import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A small file logger, deliberately hand-rolled.
 *
 * The project has two runtime dependencies and the wanted format is specific,
 * so a logging framework would cost more than it saves here. The rules that
 * matter:
 *
 * - **Logging never throws.** A failed write must not break a member's role
 *   change, so every failure is swallowed after one warning on the console.
 * - **Writes are serialised** through a promise chain, so lines cannot
 *   interleave and rotation cannot race a write.
 * - **The pure parts are separate** (`formatRecord`, `formatActor`,
 *   `shouldLog`) so the format is unit-tested without touching a disk.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const LOG_LEVELS = Object.keys(LEVEL_ORDER) as LogLevel[];

/**
 * Known event keys.
 *
 * The event column is the machine-readable half of a line — `grep
 * selection.applied logs/rolepicker.log` has to keep working — so new events
 * are added here rather than spelled inline at the call site.
 */
export type LogEvent =
  | "bot.starting"
  | "bot.ready"
  | "bot.guild_missing"
  | "config.loaded"
  | "command.invoked"
  | "selection.applied"
  | "selection.rejected"
  | "selection.noop"
  | "role.created"
  | "role.matched"
  | "role.unresolved"
  | "setup.completed"
  | "setup.failed"
  | "setup.blocked"
  | "permission.denied"
  | "error.unhandled";

/** Who or what caused the entry. */
export interface Actor {
  type: "member" | "admin" | "system";
  id?: string;
  name?: string;
}

export const SYSTEM_ACTOR: Actor = { type: "system" };

export function memberActor(id: string, name: string): Actor {
  return { type: "member", id, name };
}

export function adminActor(id: string, name: string): Actor {
  return { type: "admin", id, name };
}

export interface LogRecord {
  timestamp: Date;
  level: LogLevel;
  event: LogEvent;
  actor: Actor;
  message: string;
}

/** `member:Zak(240814…)`, or plain `system` for anything the bot did itself. */
export function formatActor(actor: Actor): string {
  if (actor.type === "system") return "system";
  const name = actor.name ?? "unknown";
  if (actor.id === undefined) return `${actor.type}:${name}`;
  return `${actor.type}:${name}(${actor.id})`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `YYYY-MM-DD HH:mm:ss.SSS` in the process's local time, so setting `TZ` in
 * the container gives timestamps in the guild's own timezone. Containers
 * default to UTC.
 */
export function formatTimestamp(date: Date): string {
  const time = [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join(":");
  const day = [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join("-");
  return `${day} ${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

const EVENT_WIDTH = 18;
/**
 * Wide enough for `member:` plus a typical username and a full 18-19 digit
 * Discord ID, so the message column lines up in the common case. IDs are never
 * truncated — a partial ID cannot be looked up.
 */
const ACTOR_WIDTH = 38;

/** One line: timestamp, level, event, actor, message. */
export function formatRecord(record: LogRecord): string {
  return [
    formatTimestamp(record.timestamp),
    record.level.toUpperCase().padEnd(5),
    record.event.padEnd(EVENT_WIDTH),
    formatActor(record.actor).padEnd(ACTOR_WIDTH),
    record.message,
  ].join("  ");
}

export function shouldLog(configured: LogLevel, level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
}

export interface LoggerOptions {
  level: LogLevel;
  /** Omit to log to the console only. */
  filePath?: string;
  /** Rotate once the file passes this size. */
  maxBytes: number;
  /** How many rotated files to keep (`.1` … `.maxFiles`). */
  maxFiles: number;
  /** Mirror entries to stdout/stderr. On by default, so `docker logs` works. */
  console?: boolean;
}

export class Logger {
  #options: LoggerOptions;
  #queue: Promise<void> = Promise.resolve();
  /** Tracked so size is not re-stat'd on every line. -1 means "unknown". */
  #size = -1;
  #warnedAboutFailure = false;

  constructor(options: LoggerOptions) {
    this.#options = options;
  }

  debug(event: LogEvent, actor: Actor, message: string): void {
    this.log("debug", event, actor, message);
  }

  info(event: LogEvent, actor: Actor, message: string): void {
    this.log("info", event, actor, message);
  }

  warn(event: LogEvent, actor: Actor, message: string): void {
    this.log("warn", event, actor, message);
  }

  error(event: LogEvent, actor: Actor, message: string): void {
    this.log("error", event, actor, message);
  }

  log(level: LogLevel, event: LogEvent, actor: Actor, message: string): void {
    if (!shouldLog(this.#options.level, level)) return;

    const line = formatRecord({ timestamp: new Date(), level, event, actor, message });

    if (this.#options.console !== false) {
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }

    if (this.#options.filePath === undefined) return;

    // Fire and forget: callers must never wait on a log write, and a failure
    // here must never surface as a failed interaction.
    this.#queue = this.#queue.then(() => this.#append(line)).catch(() => undefined);
  }

  /** Waits for queued writes. Used by tests and by a clean shutdown. */
  async flush(): Promise<void> {
    await this.#queue;
  }

  async #append(line: string): Promise<void> {
    const filePath = this.#options.filePath;
    if (filePath === undefined) return;

    const payload = `${line}\n`;

    try {
      if (this.#size < 0) this.#size = await currentSize(filePath);

      if (this.#size + payload.length > this.#options.maxBytes) {
        await this.#rotate(filePath);
        this.#size = 0;
      }

      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, payload, "utf8");
      this.#size += Buffer.byteLength(payload);
    } catch (error) {
      if (!this.#warnedAboutFailure) {
        this.#warnedAboutFailure = true;
        console.error(
          `[rolepicker] could not write to the log file at ${filePath}; continuing with console logging only.`,
          error,
        );
      }
    }
  }

  /** `file.4 -> file.5`, …, `file -> file.1`, dropping whatever fell off the end. */
  async #rotate(filePath: string): Promise<void> {
    const { maxFiles } = this.#options;
    if (maxFiles < 1) {
      await rm(filePath, { force: true });
      return;
    }

    await rm(`${filePath}.${maxFiles}`, { force: true });

    for (let index = maxFiles - 1; index >= 1; index--) {
      const from = `${filePath}.${index}`;
      const to = `${filePath}.${index + 1}`;
      try {
        await rename(from, to);
      } catch {
        // That rotation slot does not exist yet.
      }
    }

    try {
      await rename(filePath, `${filePath}.1`);
    } catch {
      // Nothing written yet.
    }
  }
}

async function currentSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}
