import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Remembers which message holds which group's picker, and which Discord role
 * the bot created for a config role.
 *
 * The message IDs let `/rolepicker setup` edit in place instead of posting
 * duplicates. The role IDs are what make a config role without an explicit
 * `discordRoleId` survive being renamed in Discord: after the first
 * resolution, the link is by ID rather than by name.
 *
 * Behind an interface because the obvious next step is a real database once
 * groups are editable from Discord rather than from a file.
 */
export interface StateStore {
  getMessageId(groupKey: string): Promise<string | undefined>;
  setMessageId(groupKey: string, messageId: string): Promise<void>;
  /** Groups that have a posted message but are no longer in the config. */
  orphanedGroupKeys(configuredKeys: readonly string[]): Promise<string[]>;
  forget(groupKey: string): Promise<void>;

  getRoleId(groupKey: string, roleKey: string): Promise<string | undefined>;
  setRoleId(groupKey: string, roleKey: string, roleId: string): Promise<void>;
  forgetRole(groupKey: string, roleKey: string): Promise<void>;
}

interface StateFile {
  /** groupKey -> message ID */
  messages: Record<string, string>;
  /** "groupKey:roleKey" -> Discord role ID */
  roles: Record<string, string>;
}

function roleKeyOf(groupKey: string, roleKey: string): string {
  return `${groupKey}:${roleKey}`;
}

export class JsonFileStateStore implements StateStore {
  #path: string;
  #cache: StateFile | undefined;
  /** Serialises writes so two fast clicks cannot interleave read-modify-write. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async #read(): Promise<StateFile> {
    if (this.#cache !== undefined) return this.#cache;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      const record = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Partial<StateFile>;
      this.#cache = {
        messages: record.messages ?? {},
        roles: record.roles ?? {},
      };
    } catch {
      // No state file yet, or it is unreadable: start clean. Losing it means
      // the next setup posts fresh messages and falls back to matching roles
      // by name.
      this.#cache = { messages: {}, roles: {} };
    }
    return this.#cache;
  }

  async #write(mutate: (state: StateFile) => void): Promise<void> {
    const run = this.#queue.then(async () => {
      const state = await this.#read();
      mutate(state);
      await mkdir(dirname(this.#path), { recursive: true });
      await writeFile(this.#path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async getMessageId(groupKey: string): Promise<string | undefined> {
    return (await this.#read()).messages[groupKey];
  }

  async setMessageId(groupKey: string, messageId: string): Promise<void> {
    await this.#write((state) => {
      state.messages[groupKey] = messageId;
    });
  }

  async orphanedGroupKeys(configuredKeys: readonly string[]): Promise<string[]> {
    const configured = new Set(configuredKeys);
    const state = await this.#read();
    return Object.keys(state.messages).filter((key) => !configured.has(key));
  }

  async forget(groupKey: string): Promise<void> {
    await this.#write((state) => {
      delete state.messages[groupKey];
    });
  }

  async getRoleId(groupKey: string, roleKey: string): Promise<string | undefined> {
    return (await this.#read()).roles[roleKeyOf(groupKey, roleKey)];
  }

  async setRoleId(groupKey: string, roleKey: string, roleId: string): Promise<void> {
    await this.#write((state) => {
      state.roles[roleKeyOf(groupKey, roleKey)] = roleId;
    });
  }

  async forgetRole(groupKey: string, roleKey: string): Promise<void> {
    await this.#write((state) => {
      delete state.roles[roleKeyOf(groupKey, roleKey)];
    });
  }
}
