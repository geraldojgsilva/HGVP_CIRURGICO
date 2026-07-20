const express = require("express");
const { execute, getConnection, oracledb } = require("../services/oracleService");
const { generateAutomationItemsExcel } = require("../services/reportService");
const { requireAuth, requireAuthOrHgvp } = require("../middleware/auth");
const { serializeOracleRow } = require("../utils/envioUtils");
const logger = require("../services/logger");

const router = express.Router();

function parseIsoDate(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    const error = new Error(`Formato invalido para '${field}'. Use YYYY-MM-DD ou ISO 8601.`);
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizarRespostaWebhook(value) {
  const text = String(value || "").trim().toUpperCase();
  if (["CONFIRMAR", "CONFIRMADO", "SIM"].includes(text)) return "CONFIRMADO";
  if (["CANCELAR", "CANCELADO", "NAO", "NÃO"].includes(text)) return "CANCELADO";
  return null;
}

async function sincronizarWebhooksRecentes(empresaId, numeroFiltro) {
  const filtro = String(numeroFiltro || "").replace(/\D/g, "");
  if (!filtro) return;

  let conn;
  try {
    conn = await getConnection();
    const webhooks = await conn.execute(
      `SELECT id, numero, texto_resposta, data_evento
         FROM DBAMV.tb_mensagem_webhook
        WHERE id_empresa = :empresaId
          AND tipo_evento = 'button'
          AND texto_resposta IS NOT NULL
          AND REGEXP_REPLACE(numero, '[^0-9]', '') LIKE :numeroFiltro
          AND data_evento >= SYSTIMESTAMP - INTERVAL '2' DAY
        ORDER BY data_evento ASC
        FETCH FIRST 50 ROWS ONLY`,
      { empresaId, numeroFiltro: `%${filtro}%` },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let atualizados = 0;
    for (const webhook of webhooks.rows || []) {
      const resposta = normalizarRespostaWebhook(webhook.TEXTO_RESPOSTA);
      const numero = String(webhook.NUMERO || "").replace(/\D/g, "");
      if (!resposta || !numero || !webhook.DATA_EVENTO) continue;

      const result = await conn.execute(
        `UPDATE DBAMV.TB_MENSAGEM_ENVIO
            SET resposta = :resposta,
                dt_resposta = :dataEvento
          WHERE id = (
            SELECT id
              FROM (
                SELECT id
                  FROM DBAMV.TB_MENSAGEM_ENVIO
                 WHERE id_empresa = :empresaId
                   AND REGEXP_REPLACE(numero, '[^0-9]', '') = :numero
                   AND status_envio = 'S'
                   AND resposta IS NULL
                   AND dt_envio <= :dataEvento
                 ORDER BY dt_envio DESC, id DESC
              )
             WHERE ROWNUM = 1
          )`,
        {
          resposta,
          dataEvento: { val: webhook.DATA_EVENTO, type: oracledb.DATE },
          empresaId,
          numero
        },
        { autoCommit: false }
      );
      atualizados += Number(result.rowsAffected || 0);
    }

    if (atualizados) await conn.commit();
    if (webhooks.rows?.length || atualizados) {
      logger.info("respostas_webhook_sync", {
        empresaId,
        numeroFiltro: filtro,
        webhooks: webhooks.rows?.length || 0,
        atualizados
      });
    }
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    logger.error("respostas_webhook_sync_failed", { error, empresaId, numeroFiltro: filtro });
  } finally {
    if (conn) await conn.close();
  }
}

router.get("/", requireAuthOrHgvp, async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const tipo = req.query.tipo_resposta || "TODOS";
    const dataCampo = req.query.data_campo === "resposta" ? "resposta" : "envio";
    const dataColumn = dataCampo === "resposta" ? "DT_RESPOSTA" : "DT_ENVIO";
    const dataIni = req.query.data_ini;
    const dataFim = req.query.data_fim;
    const numero = String(req.query.numero || "").replace(/\D/g, "");
    let page = Math.max(Number(req.query.page || 1), 1);
    const perPage = Math.min(Math.max(Number(req.query.per_page || 10), 1), 100);

    let sqlBase = "FROM DBAMV.TB_MENSAGEM_ENVIO e WHERE e.ID_EMPRESA = :empresaId";
    const filters = [];
    const binds = { empresaId: req.user.empresa_id };

    if (tipo === "AGUARDANDO") {
      filters.push("e.RESPOSTA IS NULL");
    } else if (tipo !== "TODOS") {
      filters.push("e.RESPOSTA = :tipo");
      binds.tipo = tipo;
    }

    if (dataIni) {
      filters.push(`TRUNC(e.${dataColumn}) >= TO_DATE(:dataIni, 'YYYY-MM-DD')`);
      binds.dataIni = dataIni;
    }

    if (dataFim) {
      filters.push(`TRUNC(e.${dataColumn}) <= TO_DATE(:dataFim, 'YYYY-MM-DD')`);
      binds.dataFim = dataFim;
    }

    if (numero) {
      filters.push("REGEXP_REPLACE(e.NUMERO, '[^0-9]', '') LIKE :numero");
      binds.numero = `%${numero}%`;
    }

    if (filters.length) sqlBase += ` AND ${filters.join(" AND ")}`;

    const countResult = await execute(`SELECT COUNT(*) AS TOTAL ${sqlBase}`, binds);
    const total = Number(countResult.rows[0]?.TOTAL || 0);
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    page = Math.min(page, totalPages);
    const offset = (page - 1) * perPage;

    const pageResult = await execute(
      `WITH page_rows AS (
         SELECT e.*
           ${sqlBase}
          ORDER BY e.DT_ENVIO DESC, e.ID DESC
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
       )
       SELECT
         p.ID,
         p.NOME,
         p.NUMERO,
         p.DATA_CONSULTA,
         p.HORA_CONSULTA,
         p.UNIDADE,
         p.STATUS_ENVIO,
         NVL(
           p.RESPOSTA,
           (
             SELECT CASE
                      WHEN UPPER(TRIM(w.TEXTO_RESPOSTA)) IN ('CONFIRMAR', 'CONFIRMADO', 'SIM') THEN 'CONFIRMADO'
                      WHEN UPPER(TRIM(w.TEXTO_RESPOSTA)) IN ('CANCELAR', 'CANCELADO', 'NAO', 'NÃO', 'NÃƒO') THEN 'CANCELADO'
                      ELSE UPPER(TRIM(w.TEXTO_RESPOSTA))
                    END
               FROM DBAMV.TB_MENSAGEM_WEBHOOK w
              WHERE w.ID_EMPRESA = p.ID_EMPRESA
                AND w.TIPO_EVENTO = 'button'
                AND w.TEXTO_RESPOSTA IS NOT NULL
                AND REGEXP_REPLACE(w.NUMERO, '[^0-9]', '') = REGEXP_REPLACE(p.NUMERO, '[^0-9]', '')
                AND CAST(w.DATA_EVENTO AS DATE) >= p.DT_ENVIO
                AND (
                  (SELECT MIN(p2.DT_ENVIO)
                     FROM DBAMV.TB_MENSAGEM_ENVIO p2
                    WHERE p2.ID_EMPRESA = p.ID_EMPRESA
                      AND p2.STATUS_ENVIO = 'S'
                      AND REGEXP_REPLACE(p2.NUMERO, '[^0-9]', '') = REGEXP_REPLACE(p.NUMERO, '[^0-9]', '')
                      AND p2.DT_ENVIO > p.DT_ENVIO) IS NULL
                  OR CAST(w.DATA_EVENTO AS DATE) <
                  (SELECT MIN(p2.DT_ENVIO)
                     FROM DBAMV.TB_MENSAGEM_ENVIO p2
                    WHERE p2.ID_EMPRESA = p.ID_EMPRESA
                      AND p2.STATUS_ENVIO = 'S'
                      AND REGEXP_REPLACE(p2.NUMERO, '[^0-9]', '') = REGEXP_REPLACE(p.NUMERO, '[^0-9]', '')
                      AND p2.DT_ENVIO > p.DT_ENVIO)
                )
              ORDER BY w.DATA_EVENTO DESC
              FETCH FIRST 1 ROW ONLY
           )
         ) AS RESPOSTA,
         p.DT_ENVIO,
         NVL(
           p.DT_RESPOSTA,
           (
             SELECT CAST(w.DATA_EVENTO AS DATE)
               FROM DBAMV.TB_MENSAGEM_WEBHOOK w
              WHERE w.ID_EMPRESA = p.ID_EMPRESA
                AND w.TIPO_EVENTO = 'button'
                AND w.TEXTO_RESPOSTA IS NOT NULL
                AND REGEXP_REPLACE(w.NUMERO, '[^0-9]', '') = REGEXP_REPLACE(p.NUMERO, '[^0-9]', '')
                AND CAST(w.DATA_EVENTO AS DATE) >= p.DT_ENVIO
                AND (
                  (SELECT MIN(p2.DT_ENVIO)
                     FROM DBAMV.TB_MENSAGEM_ENVIO p2
                    WHERE p2.ID_EMPRESA = p.ID_EMPRESA
                      AND p2.STATUS_ENVIO = 'S'
                      AND REGEXP_REPLACE(p2.NUMERO, '[^0-9]', '') = REGEXP_REPLACE(p.NUMERO, '[^0-9]', '')
                      AND p2.DT_ENVIO > p.DT_ENVIO) IS NULL
                  OR CAST(w.DATA_EVENTO AS DATE) <
                  (SELECT MIN(p2.DT_ENVIO)
                     FROM DBAMV.TB_MENSAGEM_ENVIO p2
                    WHERE p2.ID_EMPRESA = p.ID_EMPRESA
                      AND p2.STATUS_ENVIO = 'S'
                      AND REGEXP_REPLACE(p2.NUMERO, '[^0-9]', '') = REGEXP_REPLACE(p.NUMERO, '[^0-9]', '')
                      AND p2.DT_ENVIO > p.DT_ENVIO)
                )
              ORDER BY w.DATA_EVENTO DESC
              FETCH FIRST 1 ROW ONLY
           )
         ) AS DT_RESPOSTA
       FROM page_rows p
       ORDER BY DT_ENVIO DESC, ID DESC`,
      { ...binds, offset, limit: perPage }
    );

    res.json({
      data: pageResult.rows.map(serializeOracleRow),
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: totalPages
      },
      filters: {
        tipo_resposta: tipo,
        data_campo: dataCampo,
        data_ini: dataIni || null,
        data_fim: dataFim || null,
        numero: numero || null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/analytics", requireAuth, async (req, res, next) => {
  try {
    const startDt = req.query.start;
    const startDtIso = parseIsoDate(req.query.start, "start");
    const endDt = req.query.end;
    const endDtIso = parseIsoDate(req.query.end, "end");

    if (startDtIso > endDtIso) {
      return res.status(400).json({ error: "'start' nao pode ser posterior a 'end'." });
    }

    const result = await execute(
      `SELECT
         TRUNC(DT_ENVIO) AS DIA,
         SUM(CASE WHEN UPPER(RESPOSTA) = 'CONFIRMADO' THEN 1 ELSE 0 END) AS CONFIRMADOS,
         SUM(CASE WHEN UPPER(RESPOSTA) = 'CANCELADO' THEN 1 ELSE 0 END) AS CANCELADOS,
         SUM(CASE WHEN RESPOSTA IS NULL THEN 1 ELSE 0 END) AS PENDENTE_RESPOSTA
       FROM DBAMV.TB_MENSAGEM_ENVIO
       WHERE ID_EMPRESA = :empresaId
         AND TRUNC(DT_ENVIO) BETWEEN 
         TO_DATE(:startDt, 'YYYY-MM-DD')  
         AND TO_DATE(:endDt, 'YYYY-MM-DD')
       GROUP BY TRUNC(DT_ENVIO)
       ORDER BY TRUNC(DT_ENVIO)`,
      { empresaId: req.user.empresa_id, startDt, endDt }
    );

    res.json(
      result.rows.map((row) => ({
        [row.DIA.toISOString().slice(0, 10)]: [
          {
            confirmados: Number(row.CONFIRMADOS || 0),
            cancelados: Number(row.CANCELADOS || 0),
            pendente_resposta: Number(row.PENDENTE_RESPOSTA || 0)
          }
        ]
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.post("/report", requireAuthOrHgvp, async (req, res, next) => {
  try {
    const dataIni = parseIsoDate(req.body?.data_ini, "data_ini");
    const dataFim = parseIsoDate(req.body?.data_fim, "data_fim");

    if (dataIni > dataFim) {
      return res.status(400).json({ error: "'data_ini' nao pode ser posterior a 'data_fim'." });
    }

    const result = await execute(
      `SELECT
         NOME,
         NUMERO,
         DATA_CONSULTA,
         HORA_CONSULTA,
         STATUS_ENVIO,
         RESPOSTA,
         ESPECIALIDADE,
         DT_RESPOSTA,
         DT_ENVIO
       FROM DBAMV.TB_MENSAGEM_ENVIO
       WHERE ID_EMPRESA = :empresaId
         AND DT_ENVIO BETWEEN :dataIni AND :dataFim`,
      {
        empresaId: req.user.empresa_id,
        dataIni: { val: dataIni, type: oracledb.DATE },
        dataFim: { val: dataFim, type: oracledb.DATE }
      }
    );

    const buffer = await generateAutomationItemsExcel(result.rows?.map(serializeOracleRow));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"respostas.xlsx\"");
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
