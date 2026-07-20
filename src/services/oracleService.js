const oracledb = require("oracledb");
const fs = require("fs");
const config = require("../config");
const logger = require("./logger");

let pool;
let initialized = false;

function ensureClient() {
  if (initialized) return;
  initialized = true;

  const clientLibDir = findClientLibDir();
  if (clientLibDir) {
    try {
      oracledb.initOracleClient({ libDir: clientLibDir });
      logger.info("oracle_client_initialized", { libDir: clientLibDir });
    } catch (error) {
      logger.warn("oracle_client_init_failed", { error });
    }
  } else {
    logger.warn("oracle_client_not_configured", {
      message: "ORACLE_CLIENT_LIB_DIR nao definido. O driver tentara modo Thin."
    });
  }

  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
}

function findClientLibDir() {
  const candidates = [
    config.oracle.clientLibDir,
    "/opt/oracle/instantclient",
    "C:\\instantclient_23_0",
    "C:\\instantclient_19_29"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function getPool() {
  if (pool) return pool;
  ensureClient();

  const connectString = `${config.oracle.host}:${config.oracle.port}/${config.oracle.serviceName}`;
  try {
    pool = await oracledb.createPool({
      user: config.oracle.user,
      password: config.oracle.password,
      connectString,
      poolMin: Number(process.env.ORACLE_POOL_MIN || 1),
      poolMax: Number(process.env.ORACLE_POOL_MAX || 5),
      poolIncrement: 1
    });
  } catch (error) {
    if (String(error.message || "").includes("NJS-116")) {
      error.message = `${error.message}. Configure ORACLE_CLIENT_LIB_DIR apontando para o Oracle Instant Client, por exemplo C:\\instantclient_23_0, e reinicie a API.`;
    }
    throw error;
  }

  logger.info("oracle_pool_created", { connectString });
  return pool;
}

async function getConnection() {
  return (await getPool()).getConnection();
}

async function execute(sql, binds = {}, options = {}) {
  let connection;
  try {
    connection = await getConnection();
    return await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...options
    });
  } finally {
    if (connection) await connection.close();
  }
}

async function closePool() {
  if (pool) {
    await pool.close(10);
    pool = undefined;
  }
}

module.exports = { execute, getConnection, closePool, oracledb };
