const fs = require("fs");
const path = require("path");
const config = require("../config");
const logger = require("./logger");
const { getConnection, oracledb } = require("./oracleService");

const FINAL_STATUSES = new Set(["done", "failed", "ignored"]);

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function toDate(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row) {
  return {
    id: Number(row.ID_FILA),
    status: String(row.STATUS || "queued").toLowerCase(),
    payload: parseJson(row.PAYLOAD_JSON, {
      numero: row.NUMERO,
      empresaId: row.ID_EMPRESA,
      variaveis: []
    }),
    queuedAt: toIso(row.QUEUED_AT),
    scheduledAt: toIso(row.SCHEDULED_AT),
    startedAt: toIso(row.STARTED_AT),
    finishedAt: toIso(row.FINISHED_AT),
    result: parseJson(row.RESULT_JSON),
    error: row.ERROR_TEXT || null
  };
}

class EnvioQueueRepository {
  constructor(tableName) {
    this.tableName = tableName;
    this.batchTableName = config.envioQueue.batchTableName;
    this.batchStoragePath = config.envioQueue.batchStoragePath;
    this.queueStoragePath = config.envioQueue.storagePath;
  }

  async loadPending() {
    const result = await this.execute(
      `SELECT id_fila, status, numero, id_empresa, payload_json, queued_at,
              scheduled_at, started_at, finished_at, result_json, error_text
         FROM ${this.tableName}
        WHERE LOWER(status) IN ('queued', 'processing')
        ORDER BY scheduled_at NULLS FIRST, id_fila`,
      {},
      this.fetchOptions()
    );

    return result.rows.map(mapRow).filter((job) => !FINAL_STATUSES.has(job.status));
  }

  async loadRecent(limit = 20) {
    const result = await this.execute(
      `SELECT id_fila, status, numero, id_empresa, payload_json, queued_at,
              scheduled_at, started_at, finished_at, result_json, error_text
         FROM ${this.tableName}
        WHERE LOWER(status) IN ('done', 'failed', 'ignored')
        ORDER BY finished_at DESC NULLS LAST, id_fila DESC
        FETCH FIRST :limit ROWS ONLY`,
      { limit },
      this.fetchOptions()
    );

    return result.rows.map(mapRow);
  }

  async saveJob(job) {
    const conn = await getConnection();
    try {
      const result = await conn.execute(
        `INSERT INTO ${this.tableName}
           (status, numero, id_empresa, id_template, id_lote, payload_json, queued_at, scheduled_at)
         VALUES
           (:status, :numero, :idEmpresa, :idTemplate, :idLote, :payloadJson, :queuedAt, :scheduledAt)
         RETURNING id_fila INTO :id`,
        {
          status: job.status,
          numero: job.payload.numero,
          idEmpresa: job.payload.empresaId,
          idTemplate: job.payload.idTemplate || 1,
          idLote: job.payload.loteId || null,
          payloadJson: JSON.stringify(job.payload),
          queuedAt: toDate(job.queuedAt),
          scheduledAt: toDate(job.scheduledAt),
          id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        },
        { autoCommit: true }
      );

      return Number(result.outBinds.id[0]);
    } finally {
      await conn.close();
    }
  }

  async markProcessing(job) {
    await this.execute(
      `UPDATE ${this.tableName}
          SET status = 'processing',
              started_at = :startedAt,
              updated_at = SYSTIMESTAMP
        WHERE id_fila = :id`,
      {
        id: job.id,
        startedAt: toDate(job.startedAt)
      },
      { autoCommit: true }
    );
  }

  async finishJob(job) {
    await this.execute(
      `UPDATE ${this.tableName}
          SET status = :status,
              finished_at = :finishedAt,
              result_json = :resultJson,
              error_text = :errorText,
              updated_at = SYSTIMESTAMP
        WHERE id_fila = :id`,
      {
        id: job.id,
        status: job.status,
        finishedAt: toDate(job.finishedAt),
        resultJson: job.result ? JSON.stringify(job.result) : null,
        errorText: job.error
      },
      { autoCommit: true }
    );
  }

  async updateSchedule(job) {
    await this.execute(
      `UPDATE ${this.tableName}
          SET status = 'queued',
              scheduled_at = :scheduledAt,
              started_at = NULL,
              updated_at = SYSTIMESTAMP
        WHERE id_fila = :id`,
      {
        id: job.id,
        scheduledAt: toDate(job.scheduledAt)
      },
      { autoCommit: true }
    );
  }

  async createBatch({ empresaId, arquivoNome, arquivoPath, totalRegistros, totalAgendados, totalIgnorados }) {
    const conn = await getConnection();
    try {
      const result = await conn.execute(
        `INSERT INTO ${this.batchTableName}
           (id_empresa, arquivo_nome, arquivo_path, total_registros, total_agendados, total_ignorados)
         VALUES
           (:empresaId, :arquivoNome, :arquivoPath, :totalRegistros, :totalAgendados, :totalIgnorados)
         RETURNING id_lote INTO :id`,
        {
          empresaId,
          arquivoNome,
          arquivoPath,
          totalRegistros,
          totalAgendados,
          totalIgnorados,
          id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        },
        { autoCommit: true }
      );

      return Number(result.outBinds.id[0]);
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("envio_batch_oracle_unavailable_using_file", { error });
      return this.createLocalBatch({
        empresaId,
        arquivoNome,
        arquivoPath,
        totalRegistros,
        totalAgendados,
        totalIgnorados
      });
    } finally {
      await conn.close();
    }
  }

  async listBatches(empresaId, limit = 50) {
    try {
      const result = await this.execute(
        `SELECT
           l.id_lote,
           l.id_empresa,
           l.arquivo_nome,
           l.arquivo_path,
           l.total_registros,
           l.total_agendados,
           l.total_ignorados,
           l.created_at,
           SUM(CASE WHEN LOWER(f.status) IN ('queued', 'processing') THEN 1 ELSE 0 END) AS pendentes,
           SUM(CASE WHEN LOWER(f.status) = 'done'
                     AND DBMS_LOB.INSTR(f.result_json, '"sucesso":true') > 0 THEN 1 ELSE 0 END) AS enviados,
           SUM(CASE WHEN LOWER(f.status) = 'failed'
                     OR (LOWER(f.status) = 'done' AND DBMS_LOB.INSTR(f.result_json, '"sucesso":true') = 0)
                    THEN 1 ELSE 0 END) AS erros
         FROM ${this.batchTableName} l
         LEFT JOIN ${this.tableName} f ON f.id_lote = l.id_lote
         WHERE l.id_empresa = :empresaId
         GROUP BY l.id_lote, l.id_empresa, l.arquivo_nome, l.arquivo_path,
                  l.total_registros, l.total_agendados, l.total_ignorados, l.created_at
         ORDER BY l.created_at DESC
         FETCH FIRST :limit ROWS ONLY`,
        { empresaId, limit }
      );

      return result.rows.map((row) => ({
        id_lote: Number(row.ID_LOTE),
        id_empresa: row.ID_EMPRESA,
        arquivo_nome: row.ARQUIVO_NOME,
        arquivo_path: row.ARQUIVO_PATH,
        total_registros: Number(row.TOTAL_REGISTROS || 0),
        total_agendados: Number(row.TOTAL_AGENDADOS || 0),
        total_ignorados: Number(row.TOTAL_IGNORADOS || 0),
        pendentes: Number(row.PENDENTES || 0),
        enviados: Number(row.ENVIADOS || 0),
        erros: Number(row.ERROS || 0),
        created_at: toIso(row.CREATED_AT)
      }));
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("envio_batch_list_oracle_unavailable_using_file", { error });
      return this.listLocalBatches(empresaId, limit);
    }
  }

  async getBatch(empresaId, loteId) {
    try {
      const result = await this.execute(
        `SELECT id_lote, id_empresa, arquivo_nome, arquivo_path, total_registros,
                total_agendados, total_ignorados, created_at
           FROM ${this.batchTableName}
          WHERE id_empresa = :empresaId
            AND id_lote = :loteId`,
        { empresaId, loteId }
      );

      const row = result.rows[0];
      if (!row) return null;

      return {
        id_lote: Number(row.ID_LOTE),
        id_empresa: row.ID_EMPRESA,
        arquivo_nome: row.ARQUIVO_NOME,
        arquivo_path: row.ARQUIVO_PATH,
        total_registros: Number(row.TOTAL_REGISTROS || 0),
        total_agendados: Number(row.TOTAL_AGENDADOS || 0),
        total_ignorados: Number(row.TOTAL_IGNORADOS || 0),
        created_at: toIso(row.CREATED_AT)
      };
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("envio_batch_get_oracle_unavailable_using_file", { error, loteId });
      return this.getLocalBatch(empresaId, loteId);
    }
  }

  async loadBatchJobs(empresaId, loteId) {
    try {
      const result = await this.execute(
        `SELECT id_fila, status, numero, id_empresa, payload_json, queued_at,
                scheduled_at, started_at, finished_at, result_json, error_text
           FROM ${this.tableName}
          WHERE id_empresa = :empresaId
            AND id_lote = :loteId
          ORDER BY id_fila`,
        { empresaId, loteId },
        this.fetchOptions()
      );

      return result.rows.map(mapRow);
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("envio_batch_jobs_oracle_unavailable_using_file", { error, loteId });
      return this.loadLocalBatchJobs(empresaId, loteId);
    }
  }

  async execute(sql, binds = {}, options = {}) {
    let conn;
    try {
      conn = await getConnection();
      return await conn.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        ...options
      });
    } finally {
      if (conn) await conn.close();
    }
  }

  fetchOptions() {
    return {
      fetchInfo: {
        PAYLOAD_JSON: { type: oracledb.STRING },
        RESULT_JSON: { type: oracledb.STRING },
        ERROR_TEXT: { type: oracledb.STRING }
      }
    };
  }

  isOracleSetupError(error) {
    return ["ORA-00942", "ORA-00904", "ORA-01031"].some((code) =>
      String(error?.message || "").includes(code)
    );
  }

  createLocalBatch({ empresaId, arquivoNome, arquivoPath, totalRegistros, totalAgendados, totalIgnorados }) {
    const store = this.readBatchStore();
    const nextId = Math.max(0, ...store.batches.map((batch) => Number(batch.id_lote) || 0)) + 1;
    const batch = {
      id_lote: nextId,
      id_empresa: empresaId,
      arquivo_nome: arquivoNome,
      arquivo_path: arquivoPath,
      total_registros: totalRegistros,
      total_agendados: totalAgendados,
      total_ignorados: totalIgnorados,
      created_at: new Date().toISOString()
    };

    store.batches.unshift(batch);
    this.writeBatchStore(store);
    return batch.id_lote;
  }

  listLocalBatches(empresaId, limit) {
    const jobs = this.readLocalQueueJobs();
    return this.readBatchStore().batches
      .filter((batch) => Number(batch.id_empresa) === Number(empresaId))
      .map((batch) => this.decorateLocalBatch(batch, jobs))
      .slice(0, limit);
  }

  getLocalBatch(empresaId, loteId) {
    return this.readBatchStore().batches.find((batch) =>
      Number(batch.id_empresa) === Number(empresaId) &&
      Number(batch.id_lote) === Number(loteId)
    ) || null;
  }

  loadLocalBatchJobs(empresaId, loteId) {
    return this.readLocalQueueJobs()
      .filter((job) =>
        Number(job.payload?.empresaId) === Number(empresaId) &&
        Number(job.payload?.loteId) === Number(loteId)
      );
  }

  decorateLocalBatch(batch, jobs) {
    const batchJobs = jobs.filter((job) => Number(job.payload?.loteId) === Number(batch.id_lote));
    const pendentes = batchJobs.filter((job) => ["queued", "processing"].includes(job.status)).length;
    const enviados = batchJobs.filter((job) => job.status === "done" && job.result?.sucesso).length;
    const erros = batchJobs.filter((job) =>
      job.status === "failed" || (job.status === "done" && !job.result?.sucesso)
    ).length;

    return {
      ...batch,
      pendentes,
      enviados,
      erros
    };
  }

  readBatchStore() {
    try {
      if (!fs.existsSync(this.batchStoragePath)) return { batches: [] };
      const parsed = JSON.parse(fs.readFileSync(this.batchStoragePath, "utf8"));
      return { batches: Array.isArray(parsed.batches) ? parsed.batches : [] };
    } catch (error) {
      logger.error("envio_batch_file_read_failed", { error, storagePath: this.batchStoragePath });
      return { batches: [] };
    }
  }

  writeBatchStore(store) {
    fs.mkdirSync(path.dirname(this.batchStoragePath), { recursive: true });
    fs.writeFileSync(this.batchStoragePath, JSON.stringify(store, null, 2));
  }

  readLocalQueueJobs() {
    try {
      if (!fs.existsSync(this.queueStoragePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.queueStoragePath, "utf8"));
      return [
        ...(Array.isArray(parsed.jobs) ? parsed.jobs : []),
        ...(Array.isArray(parsed.completed) ? parsed.completed : [])
      ];
    } catch (error) {
      logger.error("envio_batch_queue_file_read_failed", { error, storagePath: this.queueStoragePath });
      return [];
    }
  }
}

module.exports = new EnvioQueueRepository(config.envioQueue.tableName);
