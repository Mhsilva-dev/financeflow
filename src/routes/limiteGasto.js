// src/routes/limiteGasto.js — Limite de gasto mensal (avisa via push quando estourar)
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');
const { mesLocal } = require('../utils/datas');

// ── GET / — Valor configurado + gasto atual do mês ───────────────────────────
router.get('/', (req, res) => {
  const db     = getDb();
  const config = db.prepare('SELECT limite_gasto FROM usuarios WHERE id = ?').get(req.uid);
  const mesAtual = mesLocal();

  const row = db.prepare(`
    SELECT COALESCE(SUM(valor), 0) AS total
    FROM transacoes WHERE usuario_id = ? AND tipo='saida' AND strftime('%Y-%m', data) = ?
  `).get(req.uid, mesAtual);

  res.json({
    ok: true,
    valor: config?.limite_gasto ?? null,
    gasto_atual: row.total
  });
});

// ── POST / — Define (ou atualiza) o limite mensal ─────────────────────────────
router.post('/', (req, res) => {
  const { valor } = req.body;
  const limite = parseFloat(valor);

  if (isNaN(limite) || limite <= 0) {
    return res.status(400).json({ ok: false, erro: 'valor deve ser um número positivo' });
  }

  const db = getDb();
  // Zera avisado_mes ao trocar o limite — se o novo valor já tiver estourado, avisa de novo
  db.prepare('UPDATE usuarios SET limite_gasto = ?, limite_avisado_mes = NULL WHERE id = ?').run(limite, req.uid);

  res.json({ ok: true });
});

// ── DELETE / — Remove o limite configurado ────────────────────────────────────
router.delete('/', (req, res) => {
  getDb().prepare('UPDATE usuarios SET limite_gasto = NULL, limite_avisado_mes = NULL WHERE id = ?').run(req.uid);
  res.json({ ok: true });
});

module.exports = router;
