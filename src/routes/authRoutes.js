const express = require("express");
const { USERS, makeToken, publicUser, requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const user = USERS[username];

  if (!user || user.password !== password) {
    return res.status(401).json({ message: "Credenciais invalidas." });
  }

  return res.json({ token: makeToken(user) });
});

router.get("/me", requireAuth, (req, res) => {
  return res.json({ data: publicUser(req.user) });
});

module.exports = router;
