const express = require("express");
const cors = require("cors");
const path = require("path");
const { errorHandler, notFoundHandler, requestLogger } = require("./middleware/errorMiddleware");
const authRoutes = require("./routes/authRoutes");
const envioRoutes = require("./routes/envioRoutes");
const respostaRoutes = require("./routes/respostaRoutes");
const logRoutes = require("./routes/logRoutes");
const preparoRoutes = require("./routes/preparoRoutes");
const frontRoutes = require("./routes/frontRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "irssl-chatbot-api", timestamp: new Date().toISOString() });
});

app.use("/static", express.static(path.resolve(__dirname, "..", "static")));
app.use("/uploads", express.static(path.resolve(__dirname, "..", "uploads")));
app.use(frontRoutes);
app.use("/api", authRoutes);
app.use("/api/envio", envioRoutes);
app.use("/api/preparos", preparoRoutes);
app.use("/api/respostas", respostaRoutes);
app.use("/api/logs", logRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
