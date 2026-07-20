const express = require("express");
const path = require("path");
const config = require("../config");

const router = express.Router();

function sendTemplate(res, filename) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return res.sendFile(path.join(config.baseDir, "templates", filename));
}

router.get("/", (_req, res) => {
  return res.redirect("/envio");
});

router.get(["/relatorio-erros-envio", "/envio/erros"], (_req, res) => {
  return sendTemplate(res, "relatorio_erros_envio.html");
});

router.get("/envio", (_req, res) => {
  return sendTemplate(res, "envio_front.html");
});

router.get("/preparos", (_req, res) => {
  return sendTemplate(res, "preparos_front.html");
});

router.get("/acompanhamento-envios", (_req, res) => {
  return sendTemplate(res, "acompanhamento_envios.html");
});

router.get("/respostas", (_req, res) => {
  return sendTemplate(res, "respostas_front.html");
});

module.exports = router;
