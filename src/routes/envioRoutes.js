const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const ExcelJS = require("exceljs");
const config = require("../config");
const logger = require("../services/logger");
const { execute, getConnection, oracledb } = require("../services/oracleService");
const { enviarConfirmacao, enviarPreparoCirurgico, enviarConfirmacaoCirurgica } = require("../services/positusService");
const envioQueue = require("../services/envioQueueService");
const envioQueueRepository = require("../services/envioQueueRepository");
const preparoRepository = require("../services/preparoRepository");
const { requireAuth } = require("../middleware/auth");
const {
  parseData,
  parseHora,
  normalizarNumero,
  formatDateBR,
  buildVariaveisEnvio,
  serializeResultadoEnvio,
  buildErroEnvio,
  extrairErroOriginal,
  parseBooleanFlag,
  worksheetToJson
} = require("../utils/envioUtils");

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.evidenceDir, { recursive: true });

const upload = multer({ dest: config.uploadDir });
const router = express.Router();

function sanitizeTemplateParam(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function parseDateFilter(value, field) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const error = new Error(`Formato invalido para '${field}'. Use YYYY-MM-DD.`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function serializeErroEnvio(row) {
  const status = row.STATUS_HTTP === null || row.STATUS_HTTP === undefined
    ? null
    : Number(row.STATUS_HTTP);
  const retorno = row.ERRO_TEXTO || row.RESPONSE_TEXT || null;
  const erro = buildErroEnvio(status, retorno);

  return {
    data_envio: row.DATA_ENVIO instanceof Date ? row.DATA_ENVIO.toISOString() : row.DATA_ENVIO,
    numero: row.NUMERO_DESTINO,
    id_empresa: row.ID_EMPRESA,
    id_template: row.ID_TEMPLATE,
    status_http: status,
    erro,
    erro_original: extrairErroOriginal(row.RESPONSE_TEXT || row.ERRO_TEXTO),
  };
}

async function enviarWrapper(numero, variaveis, empresaId) {
  let conn;
  let registroEnvio = null;
  try {
    // ✅ Date objects preservados — parseData/parseHora recebem o tipo correto
    const normalized = variaveis.map((value) => {
      if (value === null || value === undefined || value === "") return "";
      if (value instanceof Date) return value;
      if (typeof value === "string") return value.trim();
      return String(value);
    });

    const nome      = sanitizeTemplateParam(normalized[0] || "Paciente");
    const dataDt    = parseData(normalized[1]);
    const dataTpl   = dataDt ? formatDateBR(dataDt) : "Data a confirmar";
    const horaDb    = parseHora(normalized[2]);
    const horaTpl   = horaDb  || "Horario a confirmar";
    const unidade   = sanitizeTemplateParam(normalized[3] || "Unidade nao informada");
    const observacao   = sanitizeTemplateParam(normalized[4] || "");
    const especialidade = sanitizeTemplateParam(normalized[5] || "");
    const tipoInternacao = sanitizeTemplateParam(normalized[14] || "");
    const envioCirurgico = Boolean(tipoInternacao);
    const avisoCirurgico = !envioCirurgico && parseBooleanFlag(normalized[12]);
    const preparoId = Number(normalized[13] || 0) || null;
    const preparo = avisoCirurgico && preparoId
      ? await preparoRepository.get(empresaId, preparoId)
      : null;

    if (avisoCirurgico && preparoId && !preparo) {
      return [500, `Preparo cirurgico ${preparoId} nao encontrado para a empresa.`];
    }

    registroEnvio = {
      numero,
      nome,
      dataConsulta: dataTpl,
      horaConsulta: horaDb,
      unidade,
      idTemplate: envioCirurgico
        ? (config.positus.cirurgiaTemplates[tipoInternacao]?.id || 1)
        : 1,
      idEmpresa: empresaId,
      especialidade
    };

    const [status, retorno] = envioCirurgico
      ? await enviarConfirmacaoCirurgica({
          numero,
          nome,
          especialidade,
          data: dataTpl,
          hora: horaTpl,
          unidade,
          obs: observacao,
          tipoInternacao,
          idEmpresa: empresaId,
        })
      : await enviarConfirmacao({
          numero,
          nome,
          especialidade,
          data: dataTpl,
          hora: horaTpl,
          unidade,
          obs: observacao,
          idEmpresa: empresaId,
          idTemplate: 1,
        });

    let statusFinal = status;
    let retornoFinal = retorno;

    if (avisoCirurgico) {
      const [statusPreparo, retornoPreparo] = await enviarPreparoCirurgico({
        numero,
        nome,
        data: dataTpl,
        unidade,
        idEmpresa: empresaId,
        nomeTemplate: preparo?.template_name,
        namespace: preparo?.namespace,
        idTemplate: preparo?.id_preparo || config.positus.preparoTemplateId,
        documentUrl: preparo?.document_url,
        documentFilename: preparo?.document_filename,
        textoPreparo: preparo?.texto_preparo,
      });

      statusFinal = status === 200 && statusPreparo === 200 ? 200 : (statusPreparo || status || 500);
      retornoFinal = JSON.stringify({
        confirmacao: {
          status,
          retorno
        },
        preparo_cirurgico: {
          status: statusPreparo,
          retorno: retornoPreparo
        }
      });
    }

    conn = await getConnection();
    await conn.execute(
      `INSERT INTO DBAMV.tb_mensagem_envio
        (numero, nome, data_consulta, hora_consulta, unidade,
         status_envio, id_template, id_empresa, especialidade, dt_envio)
       VALUES (:numero, :nome, TO_DATE(:dataConsulta, 'DD/MM/YYYY'), :horaConsulta, :unidade,
         :statusEnvio, :idTemplate, :idEmpresa, :especialidade,
         SYSDATE)`,
      {
        ...registroEnvio,
        statusEnvio: statusFinal === 200 ? "S" : "N"
      },
      { autoCommit: true }
    );

    return [statusFinal, retornoFinal];
  } catch (error) {
    logger.error("envio_wrapper_failed", { error, numero, empresaId });
    if (registroEnvio) {
      try {
        conn = conn || await getConnection();
        await conn.execute(
          `INSERT INTO DBAMV.tb_mensagem_envio
            (numero, nome, data_consulta, hora_consulta, unidade,
             status_envio, id_template, id_empresa, especialidade, dt_envio)
           VALUES (:numero, :nome, TO_DATE(:dataConsulta, 'DD/MM/YYYY'), :horaConsulta, :unidade,
             'N', :idTemplate, :idEmpresa, :especialidade, SYSDATE)`,
          registroEnvio,
          { autoCommit: true }
        );
      } catch (insertError) {
        logger.error("envio_failed_status_insert_failed", { error: insertError, numero, empresaId });
      }
    }
    return [500, error.message];
  } finally {
    if (conn) await conn.close();
  }
}

function serializeResultadoAgendado(job, numero, variaveis) {
  const imediato = Boolean(job.immediate);
  return {
    numero,
    nome: variaveis[0],
    data: variaveis[1],
    hora: variaveis[2],
    unidade: variaveis[3],
    observacao: variaveis[4],
    especialidade: variaveis[5],
    qtd_permitida: variaveis[6],
    validacao_digitos: variaveis[7],
    validacao_nome: variaveis[8],
    validacao_datas: variaveis[9],
    validacao_hora: variaveis[10],
    validacao_unidade: variaveis[11],
    aviso_cirurgico: parseBooleanFlag(variaveis[12]),
    preparo_id: variaveis[13] || null,
    tipo_internacao: variaveis[14] || null,
    status: imediato ? "liberado" : "agendado",
    retorno: imediato ? `Liberado em ${job.scheduled_at}` : `Agendado para ${job.scheduled_at}`,
    sucesso: true,
    erro: null,
    mensagem: imediato ? "Mensagem liberada para envio imediato." : "Mensagem adicionada na fila de envio.",
    fila: job
  };
}

function parseImmediateFlag(value) {
  return parseBooleanFlag(value);
}

function safeEvidenceFilename(originalName) {
  const ext = path.extname(originalName || ".xlsx") || ".xlsx";
  const base = path.basename(originalName || "planilha", ext)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "planilha";
  return `${Date.now()}_${base}${ext}`;
}

async function buscarStatusPacienteLote(job, empresaId) {
  const queuedAt = job.queued_at ? new Date(job.queued_at) : new Date(0);
  const result = await execute(
    `SELECT status_envio, resposta, dt_envio, dt_resposta
       FROM DBAMV.TB_MENSAGEM_ENVIO
      WHERE id_empresa = :empresaId
        AND numero = :numero
        AND dt_envio >= :queuedAt
      ORDER BY dt_envio DESC
      FETCH FIRST 1 ROWS ONLY`,
    {
      empresaId,
      numero: job.numero,
      queuedAt: { val: queuedAt, type: oracledb.DATE }
    }
  );

  const row = result.rows[0];
  if (!row) return job;

  const resposta = row.RESPOSTA || null;
  return {
    ...job,
    status_qualitativo: resposta ? "respondido" : job.erro ? "erro" : "enviado",
    status_envio_banco: row.STATUS_ENVIO,
    resposta,
    dt_envio_banco: row.DT_ENVIO instanceof Date ? row.DT_ENVIO.toISOString() : row.DT_ENVIO,
    dt_resposta: row.DT_RESPOSTA instanceof Date ? row.DT_RESPOSTA.toISOString() : row.DT_RESPOSTA
  };
}

function resumoQualitativo(pacientes) {
  return pacientes.reduce((acc, item) => {
    const status = item.status_qualitativo || (
      item.status === "queued" || item.status === "processing" ? "pendente" :
      item.erro ? "erro" :
      item.status === "done" ? "enviado" : "pendente"
    );
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { pendente: 0, enviado: 0, respondido: 0, erro: 0 });
}

envioQueue.registerProcessor(async ({ numero, variaveis, empresaId }) => {
  const [status, retorno] = await enviarWrapper(numero, variaveis, empresaId);
  return serializeResultadoEnvio(numero, variaveis, status, retorno);
});

router.post("/individual", requireAuth, async (req, res, next) => {
  try {
    const empresaId = req.user.empresa_id;
    const numero = normalizarNumero(req.body?.numero);

    if (!numero) {
      return res.status(400).json({ error: "Campo 'numero' e obrigatorio." });
    }

    const variaveis = buildVariaveisEnvio(req.body || {});
    const immediate = parseImmediateFlag(req.body?.immediate);
    const job = await envioQueue.enqueue({ numero, variaveis, empresaId }, { immediate });
    const resultado = serializeResultadoAgendado(job, numero, variaveis);

    return res.status(202).json(resultado);
  } catch (error) {
    return next(error);
  }
});

router.get("/fila", requireAuth, async (_req, res, next) => {
  try {
    return res.json(await envioQueue.getStatus());
  } catch (error) {
    return next(error);
  }
});

router.get("/lotes", requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const lotes = await envioQueueRepository.listBatches(req.user.empresa_id, limit);
    return res.json({ data: lotes });
  } catch (error) {
    return next(error);
  }
});

router.get("/lotes/:id", requireAuth, async (req, res, next) => {
  try {
    const loteId = Number(req.params.id);
    const lote = await envioQueueRepository.getBatch(req.user.empresa_id, loteId);
    if (!lote) return res.status(404).json({ error: "Lote nao encontrado." });

    const jobs = await envioQueueRepository.loadBatchJobs(req.user.empresa_id, loteId);
    const publicJobs = jobs.map((job) => envioQueue.publicJob(job));
    const pacientes = [];

    for (const job of publicJobs) {
      pacientes.push(await buscarStatusPacienteLote(job, req.user.empresa_id));
    }

    return res.json({
      lote,
      resumo: resumoQualitativo(pacientes),
      pacientes
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/lotes/:id/arquivo", requireAuth, async (req, res, next) => {
  try {
    const lote = await envioQueueRepository.getBatch(req.user.empresa_id, Number(req.params.id));
    if (!lote) return res.status(404).json({ error: "Lote nao encontrado." });
    if (!lote.arquivo_path || !fs.existsSync(lote.arquivo_path)) {
      return res.status(404).json({ error: "Arquivo de evidencia nao encontrado." });
    }

    return res.download(lote.arquivo_path, lote.arquivo_nome);
  } catch (error) {
    return next(error);
  }
});

router.post("/lote", requireAuth, upload.single("arquivo"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Envie um arquivo via campo 'arquivo' (.xlsx, .xls ou .csv)." });
    }

    let rows;
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);

      const worksheet = workbook.getWorksheet(1);
      rows = worksheetToJson(worksheet);
    } catch (error) {
      logger.error("lote_read_failed", { error, filename: req.file.originalname });
      return res.status(422).json({ error: `Falha ao ler arquivo: ${error.message}` });
    }

    if (!rows.length || !Object.prototype.hasOwnProperty.call(rows[0], "numero")) {
      return res.status(422).json({ error: "A planilha deve conter a coluna 'numero'." });
    }

    const resultados = [];
    const evidenceFilename = safeEvidenceFilename(req.file.originalname);
    const evidencePath = path.join(config.evidenceDir, evidenceFilename);
    await fs.promises.copyFile(req.file.path, evidencePath);

    const validRows = rows.filter((row) => {
      const numero = normalizarNumero(row.numero);
      return numero && numero.length >= 12;
    });
    const ignoredRows = rows.length - validRows.length;
    const loteId = await envioQueueRepository.createBatch({
      empresaId: req.user.empresa_id,
      arquivoNome: req.file.originalname || evidenceFilename,
      arquivoPath: evidencePath,
      totalRegistros: rows.length,
      totalAgendados: validRows.length,
      totalIgnorados: ignoredRows
    });

    for (const row of rows) {
      const numero = normalizarNumero(row.numero);
      if (!numero) continue;

      const rowComOpcoes = {
        ...row,
        aviso_cirurgico: parseBooleanFlag(req.body?.aviso_cirurgico) ||
          parseBooleanFlag(row.aviso_cirurgico ?? row.AVISO_CIRURGICO ?? row.avisoCirurgico),
        preparo_id: req.body?.preparo_id || row.preparo_id || row.ID_PREPARO || row.preparoId
      };
      const variaveis = buildVariaveisEnvio(rowComOpcoes);
      if (numero.length < 12) {
        logger.warn("numero_invalido_ignorado", { numero });
        resultados.push(serializeResultadoEnvio(numero, variaveis, "ignorado", "Numero invalido"));
        continue;
      }

      const immediate = parseImmediateFlag(req.body?.immediate);
      const job = await envioQueue.enqueue({ numero, variaveis, empresaId: req.user.empresa_id, loteId }, { immediate });
      resultados.push(serializeResultadoAgendado(job, numero, variaveis));
    }

    const total = resultados.length;
    const enviados = resultados.filter((item) => item.status === 200).length;
    const agendados = resultados.filter((item) => item.status === "agendado").length;
    const liberados = resultados.filter((item) => item.status === "liberado").length;
    const ignorados = resultados.filter((item) => item.status === "ignorado").length;

    return res.status(202).json({
      resumo: {
        total,
        agendados,
        liberados,
        enviados,
        falhas: total - agendados - liberados - enviados - ignorados,
        ignorados
      },
      resultados
      ,
      lote: {
        id_lote: loteId,
        arquivo_nome: req.file.originalname || evidenceFilename
      }
    });
  } catch (error) {
    return next(error);
  } finally {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => { });
  }
});

router.get("/erros", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const dataIni = parseDateFilter(req.query.data_ini, "data_ini");
    const dataFim = parseDateFilter(req.query.data_fim, "data_fim");
    const binds = { limit };
    const filters = [
      "(STATUS_HTTP IS NULL OR STATUS_HTTP < 200 OR STATUS_HTTP >= 300 OR ERRO_TEXTO IS NOT NULL)"
    ];

    if (req.query.empresa_id) {
      filters.push("ID_EMPRESA = :empresaId");
      binds.empresaId = Number(req.query.empresa_id);
    }

    if (dataIni) {
      filters.push("TRUNC(DATA_ENVIO) >= TO_DATE(:dataIni, 'YYYY-MM-DD')");
      binds.dataIni = dataIni;
    }

    if (dataFim) {
      filters.push("TRUNC(DATA_ENVIO) <= TO_DATE(:dataFim, 'YYYY-MM-DD')");
      binds.dataFim = dataFim;
    }

    const result = await execute(
      `SELECT
         ID_EMPRESA,
         ID_TEMPLATE,
         NUMERO_DESTINO,
         STATUS_HTTP,
         RESPONSE_TEXT,
         PAYLOAD_ENVIADO,
         ERRO_TEXTO,
         DATA_ENVIO
       FROM DBAMV.TB_MENSAGEM_LOG_ENVIO
      WHERE ${filters.join(" AND ")}
       ORDER BY DATA_ENVIO DESC
       FETCH FIRST :limit ROWS ONLY`,
      binds,
      {
        fetchInfo: {
          RESPONSE_TEXT: { type: oracledb.STRING },
          PAYLOAD_ENVIADO: { type: oracledb.STRING },
          ERRO_TEXTO: { type: oracledb.STRING },
        },
      }
    );

    const data = result.rows.map(serializeErroEnvio);
    const byStatus = data.reduce((acc, item) => {
      const key = item.status_http ? String(item.status_http) : "sem_http";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      resumo: {
        total: data.length,
        por_status: byStatus,
      },
      data,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/modelo-lote", (req, res) => {
  const filePath = path.join(config.uploadDir, "modelo_envio_lote.xlsx");
  if (!fs.existsSync(filePath)) {
    logger.error("modelo_lote_not_found", { filePath });
    return res.status(404).json({ error: "Arquivo de modelo nao encontrado." });
  }
  return res.download(filePath, "modelo_envio_lote.xlsx");
});

module.exports = router;
