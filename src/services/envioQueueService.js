const fs = require("fs");
const path = require("path");
const config = require("../config");
const logger = require("./logger");
const oracleRepository = require("./envioQueueRepository");

const FINAL_STATUSES = new Set(["done", "failed", "ignored"]);

function parseBooleanFlag(value) {
  return ["1", "true", "sim", "s", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

class EnvioQueueService {
  constructor({ delayMs, storagePath }) {
    this.delayMs = Math.max(Number(delayMs || 0), 0);
    this.storagePath = storagePath;
    this.jobs = [];
    this.completed = [];
    this.processor = null;
    this.running = false;
    this.timer = null;
    this.nextId = 1;
    this.nextSlotAt = Date.now();
    this.initialized = false;
    this.initializing = null;
    this.useOracle = false;

    if (config.envioQueue.persistence !== "oracle") {
      this.loadFile();
      this.initialized = true;
    }
  }

  registerProcessor(processor) {
    this.processor = processor;
    this.init().then(() => this.processNext()).catch((error) => {
      logger.error("envio_queue_init_failed", { error });
    });
  }

  async enqueue(payload, options = {}) {
    await this.init();

    const immediate = Boolean(options.immediate);
    const scheduledAtMs = immediate ? Date.now() : Math.max(Date.now(), this.nextSlotAt);
    if (!immediate) {
      this.nextSlotAt = scheduledAtMs + this.delayMs;
    }

    const job = {
      id: this.nextId++,
      status: "queued",
      payload,
      queuedAt: new Date().toISOString(),
      scheduledAt: new Date(scheduledAtMs).toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      immediate
    };

    this.jobs.push(job);
    await this.saveJob(job);
    logger.info("envio_queue_enqueued", {
      id: job.id,
      numero: payload.numero,
      empresaId: payload.empresaId,
      scheduledAt: job.scheduledAt,
      immediate
    });

    this.processNext();
    return this.publicJob(job);
  }

  async ignore(payload, reason) {
    await this.init();

    const job = {
      id: this.nextId++,
      status: "ignored",
      payload,
      queuedAt: new Date().toISOString(),
      scheduledAt: null,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      result: null,
      error: reason
    };
    this.completed.unshift(job);
    this.trimCompleted();
    await this.saveJob(job);
    await this.finishStoredJob(job);
    return this.publicJob(job);
  }

  async getStatus() {
    await this.init();

    const pending = this.jobs.filter((job) => job.status === "queued").length;
    const processing = this.jobs.filter((job) => job.status === "processing").length;
    const sent = this.completed.filter((job) => this.isSent(job)).length;
    const errors = this.completed.filter((job) => this.isError(job)).length;

    return {
      delay_ms: this.delayMs,
      pending,
      processing,
      resumo: {
        saida: sent,
        pendencia: pending + processing,
        erro: errors
      },
      next_scheduled_at: this.jobs.find((job) => job.status === "queued")?.scheduledAt || null,
      jobs: this.jobs.map((job) => this.publicJob(job)),
      recent: this.completed.slice(0, 20).map((job) => this.publicJob(job))
    };
  }

  async processNext() {
    await this.init();
    if (this.running || !this.processor) return;

    const job = this.jobs
      .filter((item) => item.status === "queued")
      .sort((a, b) => new Date(a.scheduledAt || a.queuedAt || 0) - new Date(b.scheduledAt || b.queuedAt || 0))[0];
    if (!job) return;

    const waitMs = Math.max(new Date(job.scheduledAt).getTime() - Date.now(), 0);
    if (waitMs > 0) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.processNext(), waitMs);
      return;
    }

    this.running = true;
    job.status = "processing";
    job.startedAt = new Date().toISOString();
    await this.markStoredProcessing(job);

    try {
      const result = await this.processor(job.payload);
      job.status = "done";
      job.result = result;
      logger.info("envio_queue_done", {
        id: job.id,
        numero: job.payload.numero,
        status: result?.status
      });
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
      logger.error("envio_queue_failed", { error, id: job.id, numero: job.payload.numero });
    } finally {
      job.finishedAt = new Date().toISOString();
      this.jobs = this.jobs.filter((item) => item.id !== job.id);
      this.completed.unshift(job);
      this.trimCompleted();
      await this.finishStoredJob(job);
      this.running = false;
      setImmediate(() => this.processNext());
    }
  }

  publicJob(job) {
    const result = job.result || null;
    const variaveis = job.payload?.variaveis || [];
    const erro = result?.erro?.mensagem || result?.erro?.detalhe || job.error || null;

    return {
      id: job.id,
      status: job.status,
      numero: job.payload?.numero,
      nome: variaveis[0],
      data: variaveis[1],
      hora: variaveis[2],
      unidade: variaveis[3],
      observacao: variaveis[4],
      especialidade: variaveis[5],
      aviso_cirurgico: parseBooleanFlag(variaveis[12]),
      preparo_id: variaveis[13] || null,
      tipo_internacao: variaveis[14] || null,
      queued_at: job.queuedAt,
      scheduled_at: job.scheduledAt,
      immediate: Boolean(job.immediate),
      started_at: job.startedAt,
      finished_at: job.finishedAt,
      status_envio: result?.status || null,
      mensagem: result?.mensagem || erro || null,
      erro,
      result: job.result,
      error: job.error
    };
  }

  isSent(job) {
    return job.status === "done" && (job.result?.sucesso || job.result?.status === 200);
  }

  isError(job) {
    return job.status === "failed" || (job.status === "done" && !this.isSent(job));
  }

  async init() {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = this.loadOracle().catch((error) => {
      logger.warn("envio_queue_oracle_unavailable_using_file", { error });
      this.useOracle = false;
      this.loadFile();
    }).finally(() => {
      this.initialized = true;
      this.initializing = null;
    });

    return this.initializing;
  }

  async loadOracle() {
    if (config.envioQueue.persistence !== "oracle") return;

    const pendingJobs = await oracleRepository.loadPending();
    const recentJobs = await oracleRepository.loadRecent(20);
    const baseSchedule = Date.now();

    this.jobs = pendingJobs
      .sort((a, b) => new Date(a.scheduledAt || a.queuedAt || 0) - new Date(b.scheduledAt || b.queuedAt || 0))
      .map((job, index) => ({
        ...job,
        status: "queued",
        startedAt: null,
        scheduledAt: new Date(baseSchedule + index * this.delayMs).toISOString()
      }));

    await Promise.all(this.jobs.map((job) => oracleRepository.updateSchedule(job)));

    this.completed = recentJobs;
    this.nextId = Math.max(0, ...this.jobs.map((job) => Number(job.id) || 0), ...this.completed.map((job) => Number(job.id) || 0)) + 1;
    this.nextSlotAt = baseSchedule + this.jobs.length * this.delayMs;
    this.useOracle = true;

    logger.info("envio_queue_oracle_loaded", {
      pending: this.jobs.length,
      recent: this.completed.length,
      tableName: config.envioQueue.tableName
    });
  }

  loadFile() {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const content = fs.readFileSync(this.storagePath, "utf8");
      const parsed = JSON.parse(content);
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      const completed = Array.isArray(parsed.completed) ? parsed.completed : [];

      const pendingJobs = jobs
        .filter((job) => !FINAL_STATUSES.has(job.status))
        .sort((a, b) => new Date(a.scheduledAt || a.queuedAt || 0) - new Date(b.scheduledAt || b.queuedAt || 0));
      const baseSchedule = Date.now();

      this.jobs = pendingJobs
        .map((job, index) => ({
          ...job,
          status: "queued",
          startedAt: null,
          scheduledAt: new Date(baseSchedule + index * this.delayMs).toISOString()
        }));
      this.completed = completed;
      this.nextId = Math.max(0, ...jobs.map((job) => Number(job.id) || 0), ...completed.map((job) => Number(job.id) || 0)) + 1;

      this.nextSlotAt = baseSchedule + this.jobs.length * this.delayMs;
    } catch (error) {
      logger.error("envio_queue_file_load_failed", { error, storagePath: this.storagePath });
      this.jobs = [];
      this.completed = [];
    }
  }

  async saveJob(job) {
    if (this.useOracle) {
      try {
        job.id = await oracleRepository.saveJob(job);
        return;
      } catch (error) {
        this.disableOraclePersistence(error);
      }
    }

    this.persistFile();
  }

  async markStoredProcessing(job) {
    if (this.useOracle) {
      try {
        await oracleRepository.markProcessing(job);
        return;
      } catch (error) {
        this.disableOraclePersistence(error);
      }
    }

    this.persistFile();
  }

  async finishStoredJob(job) {
    if (this.useOracle) {
      try {
        await oracleRepository.finishJob(job);
        return;
      } catch (error) {
        this.disableOraclePersistence(error);
      }
    }

    this.persistFile();
  }

  disableOraclePersistence(error) {
    logger.warn("envio_queue_oracle_write_failed_using_file", {
      error,
      storagePath: this.storagePath
    });
    this.useOracle = false;
  }

  persistFile() {
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify({ jobs: this.jobs, completed: this.completed.slice(0, 100) }, null, 2)
      );
    } catch (error) {
      logger.error("envio_queue_file_persist_failed", { error, storagePath: this.storagePath });
    }
  }

  trimCompleted() {
    this.completed = this.completed.slice(0, 100);
  }
}

module.exports = new EnvioQueueService(config.envioQueue);
