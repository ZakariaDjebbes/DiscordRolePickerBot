import type { Guild } from "discord.js";
import type { ResolvedConfig, RolePickerConfig } from "../config/types.js";
import type { StateStore } from "../state/store.js";
import { resolveRoles, type ResolutionResult } from "./roleResolver.js";

/**
 * Holds the resolved view of the config — the one every handler works from.
 *
 * The file config may name roles that do not exist in Discord yet, so it is
 * resolved once at startup (without creating anything) and again on
 * `/rolepicker setup` (where creating is allowed). Handlers read whatever the
 * last resolution produced.
 */
export class RoleRegistry {
  #config: RolePickerConfig;
  #store: StateStore;
  #resolved: ResolvedConfig | undefined;

  constructor(config: RolePickerConfig, store: StateStore) {
    this.#config = config;
    this.#store = store;
  }

  /** Undefined until the first successful resolution. */
  get resolved(): ResolvedConfig | undefined {
    return this.#resolved;
  }

  /** The raw file config, including roles that may not exist in Discord yet. */
  get config(): RolePickerConfig {
    return this.#config;
  }

  async refresh(guild: Guild, options: { create: boolean }): Promise<ResolutionResult> {
    const result = await resolveRoles(guild, this.#config, this.#store, options);
    this.#resolved = result.config;
    return result;
  }
}
