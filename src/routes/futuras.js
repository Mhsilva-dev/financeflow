// src/routes/futuras.js — Despesas futuras previstas (contas a pagar)
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');

const PRIORIDADES_VALIDAS  = new Set(['baixa', 'media', 'alta']);
const REGEX_DATA           = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// ── GET / — Listar despesas futuras pendentes ─────────────────────────────────
router.get('/', (req, res) => {
  res.json({
    ok: true,
    data: getDb()
      .prepare('SELECT * FROM despesas_futuras WHERE usuario_id = ? AND concluida=0 ORDER BY data_prevista ASC')
      .all(req.uid)
  });
});

// ── POST / — Registrar nova despesa futura ────────────────────────────────────
router.post('/', (req, res) => {
  const { descricao, valor, data_prevista, prioridade } = req.body;

  if (!descricao || valor === undefined || !data_prevista) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: descricao, valor, data_prevista' });
  }

  const valorNum = parseFloat(valor);
  if (isNaN(valorNum) || valorNum <= 0) {
    return res.status(400).json({ ok: false, erro: 'valor deve ser um número positivo' });
  }

  if (!REGEX_DATA.test(data_prevista)) {
    return res.status(400).json({ ok: false, erro: 'Formato de data inválido. Use YYYY-MM-DD' });
  }

  const prio = prioridade && PRIORIDADES_VALIDAS.has(prioridade) ? prioridade : 'media';

  const db     = getDb();
  const result = db.prepare(`
    INSERT INTO despesas_futuras (descricao, valor, data_prevista, prioridade, usuario_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(descricao).trim().slice(0, 200), valorNum, data_prevista, prio, req.uid);

  res.json({ ok: true, data: db.prepare('SELECT * FROM despesas_futuras WHERE id = ?').get(result.lastInsertRowid) });
});

// ── PATCH /:id/concluir — Marcar despesa como concluída ──────────────────────
router.patch('/:id/concluir', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });
  getDb().prepare('UPDATE despesas_futuras SET concluida=1 WHERE id = ? AND usuario_id = ?').run(id, req.uid);
  res.json({ ok: true });
});

// ── DELETE /:id — Remover despesa futura ─────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });
  getDb().prepare('DELETE FROM despesas_futuras WHERE id = ? AND usuario_id = ?').run(id, req.uid);
  res.json({ ok: true });
});

module.exports = router;
