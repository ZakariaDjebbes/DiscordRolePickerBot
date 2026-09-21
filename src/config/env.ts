import "dotenv/config";

export interface Env {
  token: string;
  clientId: string;
  guildId: string;
  configPath: string;
  statePath: string;
}

export function loadEnv(): Env {
  return {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: required("DISCORD_GUILD_ID"),
    configPath: process.env["ROLE_CONFIG_PATH"] ?? "./config/roles.json",
    statePath: process.env["STATE_PATH"] ?? "./data/picker-state.json",
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}
