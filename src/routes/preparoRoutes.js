const express = require("express");
const preparoRepository = require("../services/preparoRepository");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const includeInactive = String(req.query.include_inactive || "").toLowerCase() === "true";
    const data = await preparoRepository.list(req.user.empresa_id, includeInactive);
    return res.json({ data });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = await preparoRepository.create(req.user.empresa_id, req.body || {});
    return res.status(201).json({ data });
  } catch (error) {
    return next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const idPreparo = Number(req.params.id);
    const data = await preparoRepository.update(req.user.empresa_id, idPreparo, req.body || {});
    if (!data) return res.status(404).json({ error: "Preparo nao encontrado." });
    return res.json({ data });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await preparoRepository.remove(req.user.empresa_id, Number(req.params.id));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
