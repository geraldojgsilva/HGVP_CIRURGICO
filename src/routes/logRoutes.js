const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { getErrorLog } = require("../services/logService");

const router = express.Router();

router.get("/errors", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    res.json(await getErrorLog(limit));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
