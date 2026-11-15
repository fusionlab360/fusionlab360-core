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

  try {
    console.log(`[${timestamp}] ${prefix}`, ...args);
  } catch {
    // Preserve the caller outcome if the log sink fails.
  }
}

export const logger = {
  diagnostic: (record: Record<string, unknown>) => {
    try {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...record }));
    } catch {
      // A broken log sink must never change the request outcome.
    }
  },

  debug: (...args: unknown[]) =>
    log(LogLevel.DEBUG, "[DEBUG]", ...args),

  info: (...args: unknown[]) =>
    log(LogLevel.INFO, "[INFO ]", ...args),

  warn: (...args: unknown[]) =>
    log(LogLevel.WARN, "[WARN ]", ...args),

  error: (...args: unknown[]) =>
    log(LogLevel.ERROR, "[ERROR]", ...args),
};