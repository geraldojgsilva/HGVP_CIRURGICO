const app = require("./app");
const config = require("./config");
const logger = require("./services/logger");

process.on("uncaughtException", (error) => {
  logger.fatal("uncaught_exception", { error });
});

process.on("unhandledRejection", (reason) => {
  logger.fatal("unhandled_rejection", { error: reason instanceof Error ? reason : new Error(String(reason)) });
});

const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info(`Servico Node inicializado na porta ${config.port}`);
});

server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 120000);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS || 125000);
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 1800000);
