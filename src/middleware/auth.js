const jwt = require("jsonwebtoken");
const config = require("../config");

const USERS = {
  admin: {
    id: 0,
    empresa_id: 0,
    username: "admin",
    password: process.env.AUTH_ADMIN_PASSWORD || "",
    name: "",
    email: "",
    isAdmin: true
  },
  hgvp: {
    id: 1,
    empresa_id: 1,
    username: "hgvp",
    password: process.env.AUTH_HGVP_PASSWORD || "",
    name: "",
    email: "",
    isAdmin: false
  },
  amas: {
    id: 2,
    empresa_id: 2,
    username: "amas",
    password: process.env.AUTH_AMAS_PASSWORD || "",
    name: "",
    email: "",
    isAdmin: false
  }
};

function makeToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      companyId: user.empresa_id,
      admin: String(user.isAdmin),
      sub: user.username
    },
    config.jwtSecret,
    { algorithm: "HS256" }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    empresa_id: user.empresa_id,
    username: user.username,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin
  };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token nao fornecido." });
  }

  try {
    const token = authHeader.slice("Bearer ".length);
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    const user = USERS[payload.sub];
    if (!user) throw new Error("Usuario nao encontrado");
    req.user = publicUser(user);
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Token invalido." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Acesso restrito a administradores." });
  }
  return next();
}

module.exports = { USERS, makeToken, publicUser, requireAuth, requireAdmin };
