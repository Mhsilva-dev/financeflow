// src/routes/calendario.js — Eventos recorrentes do calendário financeiro
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');

const TIPOS_VALIDOS = new Set(['gasto', 'receita']);

// ── GET / — Listar eventos do calendário ─────────────────────────────────────
router.get('/', (req, res) => {
  res.json({ ok: true, data: getDb().prepare('SELECT * FROM calendario_eventos WHERE usuario_id = ? ORDER BY dia_mes ASC').all(req.uid) });
});

// ── POST / — Criar evento recorrente ─────────────────────────────────────────
router.post('/', (req, res) => {
  const { descricao, valor, tipo, dia_mes, recorrente } = req.body;

  if (!descricao || !dia_mes) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: descricao, dia_mes' });
  }

  const dia = parseInt(dia_mes, 10);
  if (isNaN(dia) || dia < 1 || dia > 31) {
    return res.status(400).json({ ok: false, erro: 'dia_mes deve ser um número entre 1 e 31' });
  }

  const tipoValido = tipo && TIPOS_VALIDOS.has(tipo) ? tipo : 'gasto';

  const db     = getDb();
  const result = db.prepare(`
    INSERT INTO calendario_eventos (descricao, valor, tipo, dia_mes, recorrente, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    String(descricao).trim().slice(0, 200),
    parseFloat(valor) || 0,
    tipoValido,
    dia,
    recorrente ? 1 : 0,  // Bug corrigido: antes sempre retornava 1 (recorrente?1:1)
    req.uid
  );

  res.json({ ok: true, data: db.prepare('SELECT * FROM calendario_eventos WHERE id = ?').get(result.lastInsertRowid) });
});

// ── DELETE /:id — Remover evento ─────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });
  getDb().prepare('DELETE FROM calendario_eventos WHERE id = ? AND usuario_id = ?').run(id, req.uid);
  res.json({ ok: true });
});

module.exports = router;
