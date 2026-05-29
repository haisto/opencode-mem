import {
  appendFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

function getInitialLogLevel(): number {
  if (process.env.OPENCODE_MEM_DEBUG) return LOG_LEVEL_ORDER.debug;
  return LOG_LEVEL_ORDER.info;
}

let currentLogLevel: number = getInitialLogLevel();

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = LOG_LEVEL_ORDER[level];
}

export function getLogLevel(): LogLevel {
  return (Object.entries(LOG_LEVEL_ORDER) as [LogLevel, number][]).find(
    ([_, v]) => v === currentLogLevel
  )?.[0] || "info";
}

function getLogFilePath(): string {
  return process.env.OPENCODE_MEM_LOG_FILE || join(homedir(), ".opencode-mem", "opencode-mem.log");
}

function getLogDirPath(): string {
  const logFile = getLogFilePath();
  const lastSlash = Math.max(logFile.lastIndexOf("/"), logFile.lastIndexOf("\\"));
  return lastSlash === -1 ? "." : logFile.slice(0, lastSlash);
}

const MAX_LOG_SIZE = 5 * 1024 * 1024;

const GLOBAL_LOGGER_KEY = Symbol.for("opencode-mem.logger.initialized");

function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function rotateLog() {
  const logFile = getLogFilePath();
  try {
    if (!existsSync(logFile)) return;
    const stats = statSync(logFile);
    if (stats.size < MAX_LOG_SIZE) return;

    const oldLog = logFile + ".old";
    if (existsSync(oldLog)) unlinkSync(oldLog);
    renameSync(logFile, oldLog);
  } catch {}
}

function ensureLoggerInitialized() {
  if ((globalThis as any)[GLOBAL_LOGGER_KEY]) return;
  const logDir = getLogDirPath();
  const logFile = getLogFilePath();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  rotateLog();
  writeFileSync(logFile, `\n--- Session started: ${localTimestamp()} ---\n`, {
    flag: "a",
  });
  (globalThis as any)[GLOBAL_LOGGER_KEY] = true;
}

function writeLog(level: LogLevel, message: string, data?: unknown) {
  if (LOG_LEVEL_ORDER[level] < currentLogLevel) return;
  ensureLoggerInitialized();
  const logFile = getLogFilePath();
  const timestamp = localTimestamp();
  const levelTag = level.toUpperCase().padEnd(5);
  const line = data
    ? `[${timestamp}] [${levelTag}] ${message}: ${JSON.stringify(data)}\n`
    : `[${timestamp}] [${levelTag}] ${message}\n`;
  appendFileSync(logFile, line);
}

/** @deprecated Use logInfo/logWarn/logError/logDebug instead */
export function log(message: string, data?: unknown) {
  writeLog("info", message, data);
}

export function logTrace(message: string, data?: unknown) {
  writeLog("trace", message, data);
}

export function logDebug(message: string, data?: unknown) {
  writeLog("debug", message, data);
}

export function logInfo(message: string, data?: unknown) {
  writeLog("info", message, data);
}

export function logWarn(message: string, data?: unknown) {
  writeLog("warn", message, data);
}

export function logError(message: string, data?: unknown) {
  writeLog("error", message, data);
}
