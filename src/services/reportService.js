const ExcelJS = require("exceljs");

const COLORS = ["FFECB58C", "FFFCF6EE"];

function getValue(row, key) {
  return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
}

function formatDateTime(value) {
  if (!value) return " - ";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return " - ";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}

function formatDate(value) {
  if (!value) return " - ";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return " - ";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(date);
}

async function generateAutomationItemsExcel(data) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Consultas", {
    properties: { defaultRowHeight: 20 }
  });

  const columns = [
    ["Nome Paciente", "name", 50],
    ["Numero", "number", 25],
    ["Data Agenda", "date", 25],
    ["Data Envio Mensagem", "date_send", 25],
    ["Status", "status", 25],
    ["Resposta", "answer", 25],
    ["Data Resposta", "date_answer", 25],
    ["Especialidade", "type", 75]
  ];

  worksheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));

  const headerRow = worksheet.getRow(1);
  headerRow.height = 25;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCD6B23" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  let lastId = null;
  let colorIndex = 0;

  data.forEach((item) => {
    const currentId = getValue(item, "id");
    if (lastId !== null && lastId !== currentId) colorIndex = colorIndex === 0 ? 1 : 0;
    lastId = currentId;

    const dataConsulta = getValue(item, "data_consulta");
    const horaConsulta = getValue(item, "hora_consulta");
    const statusEnvio = getValue(item, "status_envio");
    const resposta = getValue(item, "resposta");

    const row = worksheet.addRow({
      name: getValue(item, "nome") || " - ",
      number: getValue(item, "numero") || " - ",
      date: dataConsulta ? `${dataConsulta?.split(" ")?.[0]} ${horaConsulta || ""}`.trim() : " - ",
      date_send: getValue(item, "dt_envio") || " - ",
      status: statusEnvio !== "S" ? "Erro no Envio" : resposta !== null && resposta !== undefined ? "Respondido" : "Pendente",
      answer: resposta || " - ",
      date_answer: getValue(item, "dt_resposta") || " - ",
      type: getValue(item, "especialidade") || " - "
    });

    row.height = 20;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS[colorIndex] } };
      cell.alignment = { horizontal: "left", vertical: "middle" };
    });
  });

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" }
      };
    });
  });

  worksheet.autoFilter = {
    from: "A1",
    to: `${worksheet.getColumn(columns.length).letter}1`
  };

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateAutomationItemsExcel };
