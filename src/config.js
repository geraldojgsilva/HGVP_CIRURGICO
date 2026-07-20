const path = require("path");
require("dotenv").config();

const BASE_DIR = path.resolve(__dirname, "..");

module.exports = {
  baseDir: BASE_DIR,
  port: Number(process.env.PORT || 9000),
  jwtSecret: process.env.JWT_SECRET || "mock-secret-key-change-in-production",
  uploadDir: process.env.UPLOAD_DIR || path.join(BASE_DIR, "uploads"),
  evidenceDir: process.env.EVIDENCE_DIR || path.join(BASE_DIR, "uploads", "evidencias"),
  logDir: process.env.LOG_DIR || path.join(BASE_DIR, "logs"),
  envioQueue: {
    persistence: process.env.ENVIO_QUEUE_PERSISTENCE || "file",
    tableName: process.env.ENVIO_QUEUE_TABLE || "DBAMV.TB_MENSAGEM_FILA_ENVIO",
    batchTableName: process.env.ENVIO_BATCH_TABLE || "DBAMV.TB_MENSAGEM_LOTE_ENVIO",
    batchStoragePath:
      process.env.ENVIO_BATCH_STORAGE_PATH ||
      path.join(process.env.UPLOAD_DIR || path.join(BASE_DIR, "uploads"), "envio-batches.json"),
    delayMs: Number(process.env.ENVIO_QUEUE_DELAY_MS || 60 * 60 * 1000),
    storagePath:
      process.env.ENVIO_QUEUE_STORAGE_PATH ||
      path.join(process.env.UPLOAD_DIR || path.join(BASE_DIR, "uploads"), "envio-queue.json")
  },
  oracle: {
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASS,
    host: process.env.ORACLE_HOST,
    port: Number(process.env.ORACLE_PORT || 1521),
    serviceName: process.env.DB_SERVICE,
    clientLibDir: process.env.ORACLE_CLIENT_LIB_DIR || process.env.ORACLE_WALLET_DIR
  },
  positus: {
    token: process.env.POSITUS_TOKEN,
    url: process.env.POSITUS_URL,
    defaultTemplateName: process.env.POSITUS_TEMPLATE_NAME || "elpis_v1",
    defaultNamespace:
      process.env.POSITUS_TEMPLATE_NAMESPACE || "fac54ef7_5fcf_4efb_a331_3b02438f176c",
    preparoTemplateName: process.env.POSITUS_PREPARO_TEMPLATE_NAME || "preparo_cirurgia_pdf",
    preparoNamespace:
      process.env.POSITUS_PREPARO_TEMPLATE_NAMESPACE ||
      process.env.POSITUS_TEMPLATE_NAMESPACE ||
      "fac54ef7_5fcf_4efb_a331_3b02438f176c",
    preparoDocumentUrl: process.env.POSITUS_PREPARO_DOCUMENT_URL,
    preparoDocumentFilename: process.env.POSITUS_PREPARO_DOCUMENT_FILENAME || "preparo-cirurgico.pdf",
    preparoTemplateId: Number(process.env.POSITUS_PREPARO_TEMPLATE_ID || 2),
    cirurgiaDocumentUrl:
      process.env.POSITUS_CIRURGIA_DOCUMENT_URL ||
      process.env.POSITUS_PREPARO_DOCUMENT_URL ||
      "https://cdn.positus.global/production/resources/samples/document.pdf",
    cirurgiaDocumentFilename:
      process.env.POSITUS_CIRURGIA_DOCUMENT_FILENAME ||
      process.env.POSITUS_PREPARO_DOCUMENT_FILENAME ||
      "document.pdf",
    cirurgiaNamespace: process.env.POSITUS_CIRURGIA_TEMPLATE_NAMESPACE || null,
    cirurgiaTemplates: {
      hospital_dia: {
        name: process.env.POSITUS_TEMPLATE_HOSPITAL_DIA || "elpis_confirm_crur",
        id: Number(process.env.POSITUS_TEMPLATE_HOSPITAL_DIA_ID || 1),
        documentUrl:
          process.env.POSITUS_CIRURGIA_HOSPITAL_DIA_DOCUMENT_URL ||
          "http://irssl.org.br/wp-content/uploads/2026/07/ORIENTACAO-PARA-PACIENTE-HOSPITAL-DIA-1.pdf",
        documentFilename:
          process.env.POSITUS_CIRURGIA_HOSPITAL_DIA_DOCUMENT_FILENAME ||
          "ORIENTACAO-PARA-PACIENTE-HOSPITAL-DIA-1.pdf"
      },
      hospital_pernoite: {
        name: process.env.POSITUS_TEMPLATE_HOSPITAL_PERNOITE || "elpis_cirur_hgvp_v2",
        id: Number(process.env.POSITUS_TEMPLATE_HOSPITAL_PERNOITE_ID || 1),
        documentUrl:
          process.env.POSITUS_CIRURGIA_HOSPITAL_PERNOITE_DOCUMENT_URL ||
          "http://irssl.org.br/wp-content/uploads/2026/07/ORIENTACOES-PARA-PACIENTES-PERNOITE-1.pdf",
        documentFilename:
          process.env.POSITUS_CIRURGIA_HOSPITAL_PERNOITE_DOCUMENT_FILENAME ||
          "ORIENTACOES-PARA-PACIENTES-PERNOITE-1.pdf"
      },
      confirma_consulta_hgvp: {
        name: process.env.POSITUS_TEMPLATE_CONFIRMA_CONSULTA_HGVP || "elpis_cofnirma_consulta_hgvp",
        id: Number(process.env.POSITUS_TEMPLATE_CONFIRMA_CONSULTA_HGVP_ID || 1),
        languageCode: "pt_PT",
        includeButtons: false,
        documentUrl:
          process.env.POSITUS_CONFIRMA_CONSULTA_HGVP_DOCUMENT_URL ||
          "http://irssl.org.br/wp-content/uploads/2026/07/SOLICITACAO-DE-CONFIRMACAO-DE-PRESENCA.pdf",
        documentFilename:
          process.env.POSITUS_CONFIRMA_CONSULTA_HGVP_DOCUMENT_FILENAME ||
          "SOLICITACAO-DE-CONFIRMACAO-DE-PRESENCA.pdf"
      },
      bucomaxilo_hgp: {
        name: process.env.POSITUS_TEMPLATE_BUCOMAXILO_HGP || "elpis_bucomaxilo_hgp",
        id: Number(process.env.POSITUS_TEMPLATE_BUCOMAXILO_HGP_ID || 1),
        languageCode: "pt_PT",
        includeButtons: false,
        documentUrl:
          process.env.POSITUS_BUCOMAXILO_HGP_DOCUMENT_URL ||
          "http://irssl.org.br/wp-content/uploads/2026/07/ORIENTACOE-LEITO-DIA-BUCOMAXILO.pdf",
        documentFilename:
          process.env.POSITUS_BUCOMAXILO_HGP_DOCUMENT_FILENAME ||
          "ORIENTACOE-LEITO-DIA-BUCOMAXILO.pdf"
      },
      paciente_leito_dia_hgvp: {
        name: process.env.POSITUS_TEMPLATE_PACIENTE_LEITO_DIA_HGVP || "elpis_paciente_leito_dia_hgvp",
        id: Number(process.env.POSITUS_TEMPLATE_PACIENTE_LEITO_DIA_HGVP_ID || 1),
        languageCode: "pt_BR",
        includeButtons: false,
        documentUrl:
          process.env.POSITUS_PACIENTE_LEITO_DIA_HGVP_DOCUMENT_URL ||
          "http://irssl.org.br/wp-content/uploads/2026/07/ORIENTACOES-PARA-PACIENTES-Leito-dia.pdf",
        documentFilename:
          process.env.POSITUS_PACIENTE_LEITO_DIA_HGVP_DOCUMENT_FILENAME ||
          "ORIENTACOES-PARA-PACIENTES-Leito-dia.pdf"
      },
      cancelamento_hgvp: {
        name: process.env.POSITUS_TEMPLATE_CANCELAMENTO_HGVP || "elpis_cancelamento_hgvp",
        id: Number(process.env.POSITUS_TEMPLATE_CANCELAMENTO_HGVP_ID || 1),
        languageCode: "pt_BR",
        includeButtons: false,
        documentUrl:
          process.env.POSITUS_CANCELAMENTO_HGVP_DOCUMENT_URL ||
          "http://irssl.org.br/wp-content/uploads/2026/07/COMUNICADO-DE-CANCELAMENTO.pdf",
        documentFilename:
          process.env.POSITUS_CANCELAMENTO_HGVP_DOCUMENT_FILENAME ||
          "COMUNICADO-DE-CANCELAMENTO.pdf"
      }
    }
  }
};
