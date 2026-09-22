import "dotenv/config";
import { LOG_LEVELS, Logger, type LogLevel } from "../logging/logger.js";

export interface Env {
  token: string;
  clientId: string;
  guildId: string;
  configPath: string;
  statePath: string;
  logLevel: LogLevel;
  /** Empty string disables file logging, leaving console output only. */
  logFile: string;
  logMaxBytes: number;
  logMaxFiles: number;
}

export function loadEnv(): Env {
  return {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: required("DISCORD_GUILD_ID"),
    configPath: process.env["ROLE_CONFIG_PATH"] ?? "./config/roles.json",
    statePath: process.env["STATE_PATH"] ?? "./data/picker-state.json",
    logLevel: logLevel(),
    logFile: process.env["LOG_FILE"] ?? "./logs/rolepicker.log",
    logMaxBytes: positiveNumber("LOG_MAX_SIZE_MB", 5) * 1024 * 1024,
    logMaxFiles: positiveNumber("LOG_MAX_FILES", 5),
  };
}

export function createLogger(env: Env): Logger {
  return new Logger({
    level: env.logLevel,
    // An explicitly empty LOG_FILE means console only.
    ...(env.logFile !== "" ? { filePath: env.logFile } : {}),
    maxBytes: env.logMaxBytes,
    maxFiles: env.logMaxFiles,
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function logLevel(): LogLevel {
  const raw = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${raw}".`);
  }
  return raw as LogLevel;
}

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}".`);
  }
  return value;
}
