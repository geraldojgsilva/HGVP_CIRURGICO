const path = require("path");
const { createLogger, format, transports } = require("winston");
const config = require("../config");
const fs = require("fs");

fs.mkdirSync(config.logDir, { recursive: true });

const appLogPath   = path.join(config.logDir, "app.log");
const errorLogPath = path.join(config.logDir, "error.log");
const SENSITIVE_KEYS = new Set([
  "password",
  "senha",
  "token",
  "authorization",
  "auth",
  "secret",
  "jwt",
  "oracle_pass"
]);

function redactSensitive(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Error) return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    code: value.code,
    status: value.status,
    statusCode: value.statusCode
  };

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, seen));

  return Object.entries(value).reduce((acc, [key, entry]) => {
    const normalized = key.toLowerCase();
    acc[key] = SENSITIVE_KEYS.has(normalized) ? "[REDACTED]" : redactSensitive(entry, seen);
    return acc;
  }, {});
}

const serializeErrors = format((info) => {
  if (info.error instanceof Error) {
    info.error = {
      name: info.error.name,
      message: info.error.message,
      stack: info.error.stack,
      // preserva propriedades extras do erro (ex: code, isRecoverable do oracledb)
      ...Object.getOwnPropertyNames(info.error).reduce((acc, key) => {
        acc[key] = info.error[key];
        return acc;
      }, {})
    };
  }
  return info;
});

const redactMeta = format((info) => {
  Object.entries(info).forEach(([key, value]) => {
    if (["level", "message", "timestamp"].includes(key)) return;
    info[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactSensitive(value);
  });
  return info;
});

const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    serializeErrors(),
    redactMeta(),
    format.json()
  ),
  transports: [
    new transports.File({
      filename: "logs/app.log",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5
    }),
    new transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5
    }),
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message }) =>
          `[${timestamp}] ${level} ${message}`
        )
      )
    })
  ]
});

logger.appLogPath = appLogPath;
logger.errorLogPath = errorLogPath;

const originalError = logger.error.bind(logger);
logger.fatal = (message, meta = {}) =>
  originalError(message, { ...meta, level: "fatal" });

module.exports = logger;
