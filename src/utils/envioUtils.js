function parseData(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const date = new Date(value.replace("Z", ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseHora(value) {
  if (!value) return null;

  if (value instanceof Date) {
    const hh = String(value.getUTCHours()).padStart(2, "0");
    const mm = String(value.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  if (typeof value === "string") {
    const hourSplit = value.split(":")
    if(hourSplit.length === 2)
      return `${hourSplit[0].padStart(2, "0")}:${hourSplit[1]}`;

    return value;
  }    

  return null;
}

function normalizarNumero(numero) {
  if (!numero) return null;
  const digits = String(numero).replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function parseBooleanFlag(value) {
  return ["1", "true", "sim", "s", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function formatDateBR(date) {
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

function buildVariaveisEnvio(source) {
  return [
    source.nome,
    source.data,
    source.hora,
    source.unidade,
    source.observacao ?? source.OBS,
    source.especialidade,
    source.qtd_permitida ?? source.QTD_PERMITIDA,
    source.validacao_digitos ?? source.VALIDACAO_DIGITOS,
    source.validacao_nome ?? source.VALIDACAO_NOME,
    source.validacao_datas ?? source.VALIDACAO_DATAS,
    source.validacao_hora ?? source.VALIDACAO_HORA,
    source.validacao_unidade ?? source.VALIDACAO_UNIDADE,
    parseBooleanFlag(source.aviso_cirurgico ?? source.AVISO_CIRURGICO ?? source.avisoCirurgico),
    source.preparo_id ?? source.ID_PREPARO ?? source.preparoId,
    source.tipo_internacao ?? source.TIPO_INTERNACAO ?? source.tipoInternacao,
  ];
}

function serializeResultadoEnvio(numero, variaveis, status, retorno) {
  const sucesso = status === 200;
  const erro = sucesso ? null : buildErroEnvio(status, retorno);

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
    status,
    retorno,
    sucesso,
    erro,
    mensagem: sucesso
      ? "Mensagem enviada com sucesso."
      : erro.mensagem,
  };
}

function buildErroEnvio(status, retorno) {
  const original = extrairErroOriginal(retorno);
  const traducao = traduzirErroEnvio(status, original);

  if (status === "ignorado") {
    return {
      tipo: "validacao",
      codigo_http: null,
      mensagem: original || "Registro ignorado antes do envio.",
      detalhe: original || null,
      original: original || null,
    };
  }

  if (!status) {
    return {
      tipo: "conexao",
      codigo_http: null,
      mensagem: traducao || "Nao foi possivel conectar ao servico de envio.",
      detalhe: original || null,
      original: original || null,
    };
  }

  return {
    tipo: "provedor",
    codigo_http: status,
    mensagem: traducao || `O provedor de mensagens retornou erro HTTP ${status}.`,
    detalhe: original || null,
    original: original || null,
  };
}

function extrairErroOriginal(retorno) {
  if (!retorno) return null;

  const textBlock = extrairBlocoErroTexto(retorno);
  if (textBlock) return formatarBlocoErro(textBlock);

  const parsed = parseJsonSafe(retorno);
  if (!parsed) return normalizarTextoErro(retorno);

  const errorBlock = Array.isArray(parsed?.errors) ? parsed.errors[0] : parsed?.errors;
  const errorText = formatarBlocoErro(errorBlock);
  if (errorText) return errorText;

  return normalizarTextoErro(
    parsed?.error?.error_data?.details ||
    parsed?.error?.details ||
    parsed?.error?.message ||
    parsed?.errors?.[0]?.message ||
    parsed?.errors?.[0]?.detail ||
    parsed?.message ||
    parsed?.detail ||
    parsed?.title ||
    retorno
  );
}

function extrairBlocoErroTexto(value) {
  if (!value || typeof value !== "string") return null;

  const code = value.match(/"code"\s*:\s*"?([^",\r\n}]+)"?/i)?.[1];
  const title = value.match(/"title"\s*:\s*"([^"]+)"/i)?.[1];
  const details = value.match(/"details"\s*:\s*"([^"]+)"/i)?.[1];

  if (!code && !title && !details) return null;
  return { code, title, details };
}

function formatarBlocoErro(errorBlock) {
  if (!errorBlock || typeof errorBlock !== "object") return null;

  const code = normalizarTextoErro(errorBlock.code);
  const title = normalizarTextoErro(errorBlock.title);
  const details = normalizarTextoErro(errorBlock.details || errorBlock.detail);
  const message = normalizarTextoErro(errorBlock.message);
  const parts = [];

  if (code) parts.push(`Codigo ${code}`);
  if (title) parts.push(title);
  if (details) parts.push(details);
  if (!parts.length && message) parts.push(message);

  return parts.join(" - ") || null;
}

function parseJsonSafe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizarTextoErro(value) {
  if (!value) return null;
  if (typeof value === "object") return null;

  const text = String(value).trim();
  if (!text || text === "[object Object]") return null;
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

function traduzirErroEnvio(status, original) {
  const text = String(original || "").toLowerCase();

  if (
    text.includes("132018") ||
    text.includes("param text cannot have new-line/tab characters") ||
    text.includes("new-line/tab characters") ||
    text.includes("more than 4 consecutive spaces") ||
    text.includes("parameters in your template")
  ) {
    return "Ha um problema nos parametros do template: o texto enviado nao pode conter quebra de linha, tabulacao ou mais de 4 espacos consecutivos.";
  }

  if (text.includes("infelizmente") && text.includes("não foi possível enviar sua mensagem")) {
    return "O provedor nao conseguiu processar o envio e nao informou um detalhe tecnico especifico. Confira os dados do paciente e tente reenviar; se repetir, consulte a Positus com o numero e horario do envio.";
  }

  if (text.includes("timed out") || text.includes("timeout")) {
    return "O provedor demorou demais para responder. Tente reenviar mais tarde.";
  }

  if (text.includes("invalid parameter") || text.includes("missing") || text.includes("empty")) {
    return "Dados enviados incompletos ou invalidos. Confira numero, template e variaveis da mensagem.";
  }

  if (text.includes("access token") || text.includes("oauth") || text.includes("unauthorized")) {
    return "Falha de autenticacao com o provedor de mensagens. Verifique token e credenciais da Positus.";
  }

  if (text.includes("template") && (text.includes("not found") || text.includes("does not exist"))) {
    return "Template de mensagem nao encontrado ou nao aprovado no provedor.";
  }

  if (text.includes("undeliverable") || text.includes("131026")) {
    return "Mensagem nao entregue pelo WhatsApp. O numero pode ser invalido, inexistente ou sem WhatsApp.";
  }

  if (text.includes("rate limit") || text.includes("too many requests")) {
    return "Limite de envios atingido no provedor. Aguarde alguns minutos antes de tentar novamente.";
  }

  if (Number(status) >= 500) {
    return "O provedor de mensagens retornou erro interno. O envio nao foi confirmado.";
  }

  if (Number(status) >= 400) {
    return "O provedor recusou o envio. Confira os dados enviados e o detalhe original do erro.";
  }

  return original || null;
}

function serializeOracleRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.toUpperCase(),
      value instanceof Date ? _formatDate(value) : value,
    ])
  );
}

function _getCellValue(cell) {
  const raw = cell.value;

  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw;

  if (typeof raw === "object" && "result" in raw) {
    const result = raw.result;
    return result instanceof Date ? result : (result ?? "");
  }

  if (typeof raw === "string") return raw.trim();
  return raw;
}

function worksheetToJson(worksheet) {
  const headers = worksheet
    .getRow(1)
    .values.slice(1)
    .map((h) => (h ? String(h).trim() : null));

  const rows = [];

  for (let i = 2; i <= worksheet.rowCount; i++) {
    const row = worksheet.getRow(i);
    const obj = {};
    let hasData = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const value = _getCellValue(row.getCell(index + 1));
      obj[header] = value;
      if (value !== "" && value !== null && value !== undefined) hasData = true;
    });

    // Ignora linhas completamente vazias
    if (hasData) rows.push(obj);
  }

  return rows;
}

function _formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

module.exports = {
  parseData,
  parseHora,
  normalizarNumero,
  parseBooleanFlag,
  formatDateBR,
  buildVariaveisEnvio,
  serializeResultadoEnvio,
  buildErroEnvio,
  extrairErroOriginal,
  serializeOracleRow,
  worksheetToJson,
};
