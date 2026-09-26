// src/middleware/auth.js — Exige sessão válida e expõe o dono dos dados em req.uid
// Todas as rotas de dados filtram por req.uid, então um usuário nunca enxerga
// (nem altera) o que pertence a outro.
const { getDb } = require('../db');

// Última requisição de cada usuário (em memória) — usada pelo painel admin para saber quem está online
const ultimaAtividade = new Map();

function exigirLogin(req, res, next) {
  const uid = req.session?.userId;
  if (!uid) return res.status(401).json({ ok: false, erro: 'Faça login para continuar' });
  req.uid = uid;
  ultimaAtividade.set(uid, Date.now());
  next();
}

// Consulta o banco (e não a sessão) para o papel valer na hora, inclusive em sessões antigas
function exigirAdmin(req, res, next) {
  const user = getDb().prepare('SELECT papel FROM usuarios WHERE id = ?').get(req.session?.userId);
  if (user?.papel !== 'admin') return res.status(403).json({ ok: false, erro: 'Acesso restrito' });
  next();
}

module.exports = { exigirLogin, exigirAdmin, ultimaAtividade };
