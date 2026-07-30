export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

const CURRENT_LEVEL =
  (globalThis as any).LOG_LEVEL === "DEBUG"
    ? LogLevel.DEBUG
    : (globalThis as any).LOG_LEVEL === "INFO"
    ? LogLevel.INFO
    : (globalThis as any).LOG_LEVEL === "WARN"
    ? LogLevel.WARN
    : LogLevel.ERROR;

function log(level: LogLevel, prefix: string, ...args: unknown[]) {
  if (level < CURRENT_LEVEL) return;

  const timestamp = new Date().toISOString();

  console.log(
    `[${timestamp}] ${prefix}`,
    ...args
  );
}

export const logger = {
  debug: (...args: unknown[]) =>
    log(LogLevel.DEBUG, "[DEBUG]", ...args),

  info: (...args: unknown[]) =>
    log(LogLevel.INFO, "[INFO ]", ...args),

  warn: (...args: unknown[]) =>
    log(LogLevel.WARN, "[WARN ]", ...args),

  error: (...args: unknown[]) =>
    log(LogLevel.ERROR, "[ERROR]", ...args),
};