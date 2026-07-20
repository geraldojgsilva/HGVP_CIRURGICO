const logger = require("../services/logger");

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const meta = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip
    };

    if (res.statusCode >= 500) logger.error("http_error_response", meta);
    else logger.info("http_request", meta);
  });
  next();
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: "Not found" });
}

function errorHandler(err, req, res, _next) {
  // Passa o Error direto — winston.errors({ stack: true }) serializa automaticamente
  logger.error("request_exception", {
    error: err,
    method: req.method,
    path: req.originalUrl,
    body: req.body
  });

  const oracleSetupError = ["ORA-00942", "ORA-00904", "ORA-01031"].some((code) =>
    String(err.message || "").includes(code)
  );
  const status = oracleSetupError ? 503 : (err.statusCode || err.status || 500);
  res.status(status).json({
    error: oracleSetupError
      ? "Persistencia Oracle da fila/lotes nao esta pronta. Execute docs/sql/setup_persistencia_envio.sql como DBAMV ou usuario com permissao, depois reinicie a API."
      : status >= 500 ? "Erro interno no servidor." : err.message
  });
}

module.exports = { requestLogger, notFoundHandler, errorHandler };
