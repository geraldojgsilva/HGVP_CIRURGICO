const fs = require("fs");
const path = require("path");
const config = require("../config");
const logger = require("./logger");
const { getConnection, oracledb } = require("./oracleService");

const TABLE_NAME = process.env.PREPARO_TABLE || "DBAMV.TB_PREPARO_CIRURGICO";
const STORAGE_PATH = process.env.PREPARO_STORAGE_PATH ||
  path.join(process.env.UPLOAD_DIR || path.join(config.baseDir, "uploads"), "preparos.json");

function toBool(value) {
  return value === true || value === "S" || value === "1" || value === 1;
}

function normalizePreparo(row) {
  return {
    id_preparo: Number(row.ID_PREPARO ?? row.id_preparo),
    id_empresa: Number(row.ID_EMPRESA ?? row.id_empresa),
    nome: row.NOME ?? row.nome,
    template_name: row.TEMPLATE_NAME ?? row.template_name,
    namespace: row.NAMESPACE ?? row.namespace,
    document_url: row.DOCUMENT_URL ?? row.document_url,
    document_filename: row.DOCUMENT_FILENAME ?? row.document_filename,
    texto_preparo: row.TEXTO_PREPARO ?? row.texto_preparo ?? "",
    ativo: toBool(row.ATIVO ?? row.ativo),
    created_at: row.CREATED_AT ?? row.created_at ?? null,
    updated_at: row.UPDATED_AT ?? row.updated_at ?? null,
  };
}

class PreparoRepository {
  async list(empresaId, includeInactive = false) {
    try {
      const filters = ["id_empresa = :empresaId"];
      if (!includeInactive) filters.push("ativo = 'S'");
      const result = await this.execute(
        `SELECT id_preparo, id_empresa, nome, template_name, namespace,
                document_url, document_filename, texto_preparo, ativo, created_at, updated_at
           FROM ${TABLE_NAME}
          WHERE ${filters.join(" AND ")}
          ORDER BY nome`,
        { empresaId }
      );
      return result.rows.map(normalizePreparo);
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("preparo_oracle_unavailable_using_file", { error });
      return this.listLocal(empresaId, includeInactive);
    }
  }

  async get(empresaId, idPreparo) {
    if (!idPreparo) return null;
    try {
      const result = await this.execute(
        `SELECT id_preparo, id_empresa, nome, template_name, namespace,
                document_url, document_filename, texto_preparo, ativo, created_at, updated_at
           FROM ${TABLE_NAME}
          WHERE id_empresa = :empresaId
            AND id_preparo = :idPreparo`,
        { empresaId, idPreparo }
      );
      return result.rows[0] ? normalizePreparo(result.rows[0]) : null;
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("preparo_get_oracle_unavailable_using_file", { error, idPreparo });
      return this.getLocal(empresaId, idPreparo);
    }
  }

  async create(empresaId, data) {
    const preparo = this.validate(data);
    try {
      const conn = await getConnection();
      try {
        const result = await conn.execute(
          `INSERT INTO ${TABLE_NAME}
             (id_empresa, nome, template_name, namespace, document_url, document_filename, texto_preparo, ativo)
           VALUES
             (:empresaId, :nome, :templateName, :namespace, :documentUrl, :documentFilename, :textoPreparo, :ativo)
           RETURNING id_preparo INTO :id`,
          {
            empresaId,
            nome: preparo.nome,
            templateName: preparo.template_name,
            namespace: preparo.namespace,
            documentUrl: preparo.document_url,
            documentFilename: preparo.document_filename,
            textoPreparo: preparo.texto_preparo,
            ativo: preparo.ativo ? "S" : "N",
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          },
          { autoCommit: true }
        );
        return this.get(empresaId, Number(result.outBinds.id[0]));
      } finally {
        await conn.close();
      }
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("preparo_create_oracle_unavailable_using_file", { error });
      return this.createLocal(empresaId, preparo);
    }
  }

  async update(empresaId, idPreparo, data) {
    const preparo = this.validate(data);
    try {
      await this.execute(
        `UPDATE ${TABLE_NAME}
            SET nome = :nome,
                template_name = :templateName,
                namespace = :namespace,
                document_url = :documentUrl,
                document_filename = :documentFilename,
                texto_preparo = :textoPreparo,
                ativo = :ativo,
                updated_at = SYSTIMESTAMP
          WHERE id_empresa = :empresaId
            AND id_preparo = :idPreparo`,
        {
          empresaId,
          idPreparo,
          nome: preparo.nome,
          templateName: preparo.template_name,
          namespace: preparo.namespace,
          documentUrl: preparo.document_url,
          documentFilename: preparo.document_filename,
          textoPreparo: preparo.texto_preparo,
          ativo: preparo.ativo ? "S" : "N",
        },
        { autoCommit: true }
      );
      return this.get(empresaId, idPreparo);
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("preparo_update_oracle_unavailable_using_file", { error, idPreparo });
      return this.updateLocal(empresaId, idPreparo, preparo);
    }
  }

  async remove(empresaId, idPreparo) {
    try {
      await this.execute(
        `UPDATE ${TABLE_NAME}
            SET ativo = 'N',
                updated_at = SYSTIMESTAMP
          WHERE id_empresa = :empresaId
            AND id_preparo = :idPreparo`,
        { empresaId, idPreparo },
        { autoCommit: true }
      );
      return { ok: true };
    } catch (error) {
      if (!this.isOracleSetupError(error)) throw error;
      logger.warn("preparo_remove_oracle_unavailable_using_file", { error, idPreparo });
      return this.removeLocal(empresaId, idPreparo);
    }
  }

  validate(data) {
    const nome = String(data?.nome || "").trim();
    const documentUrl = String(data?.document_url || "").trim();
    if (!nome) {
      const error = new Error("Informe o nome do preparo.");
      error.statusCode = 400;
      throw error;
    }
    if (!documentUrl) {
      const error = new Error("Informe a URL do PDF/link de preparo.");
      error.statusCode = 400;
      throw error;
    }

    return {
      nome,
      template_name: String(data?.template_name || config.positus.preparoTemplateName).trim(),
      namespace: String(data?.namespace || config.positus.preparoNamespace || "").trim(),
      document_url: documentUrl,
      document_filename: String(data?.document_filename || config.positus.preparoDocumentFilename).trim(),
      texto_preparo: String(data?.texto_preparo || "").trim().slice(0, 1000),
      ativo: data?.ativo === undefined ? true : toBool(data.ativo),
    };
  }

  async execute(sql, binds = {}, options = {}) {
    let conn;
    try {
      conn = await getConnection();
      return await conn.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        ...options,
      });
    } finally {
      if (conn) await conn.close();
    }
  }

  isOracleSetupError(error) {
    return ["ORA-00942", "ORA-00904", "ORA-01031"].some((code) =>
      String(error?.message || "").includes(code)
    );
  }

  readStore() {
    try {
      if (!fs.existsSync(STORAGE_PATH)) return { preparos: [] };
      const parsed = JSON.parse(fs.readFileSync(STORAGE_PATH, "utf8"));
      return { preparos: Array.isArray(parsed.preparos) ? parsed.preparos : [] };
    } catch (error) {
      logger.error("preparo_file_read_failed", { error, storagePath: STORAGE_PATH });
      return { preparos: [] };
    }
  }

  writeStore(store) {
    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(store, null, 2));
  }

  listLocal(empresaId, includeInactive) {
    return this.readStore().preparos
      .filter((item) => Number(item.id_empresa) === Number(empresaId))
      .filter((item) => includeInactive || item.ativo)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  }

  getLocal(empresaId, idPreparo) {
    return this.readStore().preparos.find((item) =>
      Number(item.id_empresa) === Number(empresaId) &&
      Number(item.id_preparo) === Number(idPreparo)
    ) || null;
  }

  createLocal(empresaId, data) {
    const store = this.readStore();
    const now = new Date().toISOString();
    const id = Math.max(0, ...store.preparos.map((item) => Number(item.id_preparo) || 0)) + 1;
    const preparo = {
      id_preparo: id,
      id_empresa: Number(empresaId),
      ...data,
      created_at: now,
      updated_at: now,
    };
    store.preparos.push(preparo);
    this.writeStore(store);
    return preparo;
  }

  updateLocal(empresaId, idPreparo, data) {
    const store = this.readStore();
    const index = store.preparos.findIndex((item) =>
      Number(item.id_empresa) === Number(empresaId) &&
      Number(item.id_preparo) === Number(idPreparo)
    );
    if (index < 0) return null;
    store.preparos[index] = {
      ...store.preparos[index],
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.writeStore(store);
    return store.preparos[index];
  }

  removeLocal(empresaId, idPreparo) {
    const existing = this.getLocal(empresaId, idPreparo);
    if (!existing) return { ok: true };
    this.updateLocal(empresaId, idPreparo, { ...existing, ativo: false });
    return { ok: true };
  }
}

module.exports = new PreparoRepository();
