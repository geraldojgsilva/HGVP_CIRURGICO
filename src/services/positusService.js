const axios = require("axios");
const config = require("../config");
const logger = require("./logger");
const { getConnection } = require("./oracleService");

async function gravaLogEnvio({
  idEnvio,
  idEmpresa,
  idTemplate,
  numeroDestino,
  statusHttp,
  responseText,
  payloadEnviado,
  erroTexto
}) {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `INSERT INTO DBAMV.tb_mensagem_log_envio
        (id_envio, id_empresa, id_template, numero_destino, status_http,
         response_text, payload_enviado, erro_texto, data_envio)
       VALUES (:idEnvio, :idEmpresa, :idTemplate, :numeroDestino, :statusHttp,
         :responseText, :payloadEnviado, :erroTexto, SYSDATE)`,
      {
        idEnvio,
        idEmpresa,
        idTemplate,
        numeroDestino,
        statusHttp,
        responseText,
        payloadEnviado: JSON.stringify(payloadEnviado),
        erroTexto
      },
      { autoCommit: true }
    );
  } catch (error) {
    logger.error("positus_log_insert_failed", { error, numeroDestino });
  } finally {
    if (conn) await conn.close();
  }
}

async function enviarTemplate({
  numero,
  payload,
  token,
  url,
  templateName,
  idEnvio,
  idEmpresa,
  idTemplate
}) {
  try {
    const response = await axios.post(url, payload, {
      timeout: Number(process.env.POSITUS_TIMEOUT_MS || 20000),
      proxy: false,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      validateStatus: () => true
    });

    const responseText =
      typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    logger.info("positus_sent", { numero, status: response.status, templateName });
    await gravaLogEnvio({
      idEnvio,
      idEmpresa,
      idTemplate,
      numeroDestino: numero,
      statusHttp: response.status,
      responseText,
      payloadEnviado: payload,
      erroTexto: null
    });

    return [response.status, responseText];
  } catch (error) {
    logger.error("positus_send_failed", { error, numero, templateName });
    await gravaLogEnvio({
      idEnvio,
      idEmpresa,
      idTemplate,
      numeroDestino: numero,
      statusHttp: null,
      responseText: null,
      payloadEnviado: payload,
      erroTexto: error.message
    });
    return [null, error.message];
  }
}

async function enviarConfirmacao({
  numero,
  nome,
  especialidade,
  data,
  hora,
  unidade,
  obs,
  tokenEmpresa,
  urlEmpresa,
  nomeTemplate,
  namespace,
  numeroWhatsapp,
  idEnvio,
  idEmpresa,
  idTemplate = 1
}) {
  const token = tokenEmpresa || config.positus.token;
  const url = urlEmpresa || config.positus.url;
  const templateName = nomeTemplate || config.positus.defaultTemplateName;
  const templateNamespace = namespace || config.positus.defaultNamespace;
  const obsFormatted = obs?.trim() || "Sem observacoes.";

  const payload = {
    from: numeroWhatsapp || null,
    to: numero,
    type: "template",
    template: {
      namespace: templateNamespace,
      name: templateName,
      language: { policy: "deterministic", code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: nome || "" },
            { type: "text", text: especialidade || "" },
            { type: "text", text: data || "" },
            { type: "text", text: hora || "" },
            { type: "text", text: unidade || "" },
            { type: "text", text: obsFormatted }
          ]
        }
      ]
    },
    messaging_product: "whatsapp"
  };

  return enviarTemplate({
    numero,
    payload,
    token,
    url,
    templateName,
    idEnvio,
    idEmpresa,
    idTemplate
  });
}

async function enviarPreparoCirurgico({
  numero,
  nome,
  data,
  unidade,
  tokenEmpresa,
  urlEmpresa,
  nomeTemplate,
  namespace,
  numeroWhatsapp,
  idEnvio,
  idEmpresa,
  idTemplate = config.positus.preparoTemplateId,
  documentUrl,
  documentFilename,
  textoPreparo
}) {
  const token = tokenEmpresa || config.positus.token;
  const url = urlEmpresa || config.positus.url;
  const templateName = nomeTemplate || config.positus.preparoTemplateName;
  const templateNamespace = namespace || config.positus.preparoNamespace;
  const preparoUrl = documentUrl || config.positus.preparoDocumentUrl;
  const preparoFilename = documentFilename || config.positus.preparoDocumentFilename;
  const bodyParameters = [
    { type: "text", text: nome || "Paciente" },
    { type: "text", text: data || "Data a confirmar" },
    { type: "text", text: unidade || "Unidade nao informada" }
  ];

  if (textoPreparo) {
    bodyParameters.push({ type: "text", text: String(textoPreparo).slice(0, 1000) });
  }

  if (!preparoUrl) {
    const message = "POSITUS_PREPARO_DOCUMENT_URL nao configurado para envio de preparo cirurgico.";
    logger.error("positus_preparo_not_configured", { numero, templateName, idEmpresa });
    return [null, message];
  }

  const payload = {
    from: numeroWhatsapp || null,
    to: numero,
    type: "template",
    template: {
      namespace: templateNamespace,
      name: templateName,
      language: { policy: "deterministic", code: "pt_BR" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "document",
              document: {
                link: preparoUrl,
                filename: preparoFilename
              }
            }
          ]
        },
        {
          type: "body",
          parameters: bodyParameters
        }
      ]
    },
    messaging_product: "whatsapp"
  };

  return enviarTemplate({
    numero,
    payload,
    token,
    url,
    templateName,
    idEnvio,
    idEmpresa,
    idTemplate
  });
}

function resolveCirurgiaTemplate(tipoInternacao) {
  const key = String(tipoInternacao || "").trim().toLowerCase();
  const templates = config.positus.cirurgiaTemplates || {};
  return templates[key] || null;
}

function buildConfirmacaoButtons() {
  return [
    {
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: "CONFIRMAR" }]
    },
    {
      type: "button",
      sub_type: "quick_reply",
      index: "1",
      parameters: [{ type: "payload", payload: "CANCELAR" }]
    }
  ];
}

async function enviarConfirmacaoCirurgica({
  numero,
  nome,
  especialidade,
  data,
  hora,
  unidade,
  obs,
  tipoInternacao,
  tokenEmpresa,
  urlEmpresa,
  namespace,
  numeroWhatsapp,
  idEnvio,
  idEmpresa,
  documentUrl,
  documentFilename
}) {
  const template = resolveCirurgiaTemplate(tipoInternacao);
  if (!template) {
    return [400, "Selecione um template de envio valido."];
  }

  const token = tokenEmpresa || config.positus.token;
  const url = urlEmpresa || config.positus.url;
  const templateName = template.name;
  const templateNamespace = namespace || config.positus.cirurgiaNamespace;
  const obsFormatted = obs?.trim() || "Sem observacoes.";
  const cirurgiaDocumentUrl = documentUrl || template.documentUrl || config.positus.cirurgiaDocumentUrl;
  const cirurgiaDocumentFilename =
    documentFilename || template.documentFilename || config.positus.cirurgiaDocumentFilename;

  if (!cirurgiaDocumentUrl) {
    const message = "POSITUS_CIRURGIA_DOCUMENT_URL nao configurado para envio de confirmacao cirurgica.";
    logger.error("positus_cirurgia_document_not_configured", { numero, templateName, idEmpresa });
    return [null, message];
  }

  const payload = {
    from: numeroWhatsapp || null,
    to: numero,
    type: "template",
    template: {
      name: templateName,
      language: { policy: "deterministic", code: template.languageCode || "pt_BR" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "document",
              document: {
                link: cirurgiaDocumentUrl,
                filename: cirurgiaDocumentFilename
              }
            }
          ]
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: nome || "" },
            { type: "text", text: especialidade || "" },
            { type: "text", text: data || "" },
            { type: "text", text: hora || "" },
            { type: "text", text: unidade || "" },
            { type: "text", text: obsFormatted }
          ]
        },
        ...(template.includeButtons === false ? [] : buildConfirmacaoButtons())
      ]
    },
    messaging_product: "whatsapp"
  };

  if (templateNamespace) {
    payload.template.namespace = templateNamespace;
  }

  logger.info("positus_cirurgia_payload_ready", {
    numero,
    templateName,
    tipoInternacao,
    documentUrl: cirurgiaDocumentUrl,
    documentFilename: cirurgiaDocumentFilename
  });

  return enviarTemplate({
    numero,
    payload,
    token,
    url,
    templateName,
    idEnvio,
    idEmpresa,
    idTemplate: template.id
  });
}

module.exports = { enviarConfirmacao, enviarPreparoCirurgico, enviarConfirmacaoCirurgica, gravaLogEnvio };
