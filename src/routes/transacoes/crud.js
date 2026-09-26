// src/routes/transacoes/crud.js
// Criar, editar, mudar status e apagar uma transação individual.
// Ações em lote (mês inteiro, duplicar) ficam em lote.js.
const express = require('express');
const router  = express.Router();
const { getDb } = require('../../db');
const { hojeLocal } = require('../../utils/datas');
const { TIPOS_VALIDOS, STATUS_VALIDOS, REGEX_DATA, bancoDoUsuario } = require('./helpers');

// ── POST / — Criar transação manual ─────────────────────────────────────────
router.post('/', (req, res) => {
  const db = getDb();
  const { descricao, tipo, categoria, valor, data, origem, banco_id } = req.body;

  // Validações de entrada
  if (!descricao || !tipo || valor === undefined || valor === null) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: descricao, tipo, valor' });
  }
  if (!TIPOS_VALIDOS.has(tipo)) {
    return res.status(400).json({ ok: false, erro: 'Tipo inválido. Use "entrada" ou "saida"' });
  }
  const valorNum = parseFloat(valor);
  if (isNaN(valorNum) || valorNum <= 0) {
    return res.status(400).json({ ok: false, erro: 'Valor deve ser um número positivo' });
  }
  if (data && !REGEX_DATA.test(data)) {
    return res.status(400).json({ ok: false, erro: 'Formato de data inválido. Use YYYY-MM-DD' });
  }

  const hoje = hojeLocal();
  const statusVal = STATUS_VALIDOS.has(req.body.status) ? req.body.status : 'pago';
  const bancoIdNum = bancoDoUsuario(db, req.uid, banco_id);
  const result = db.prepare(`
    INSERT INTO transacoes (descricao, tipo, categoria, valor, data, origem, status, banco_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(descricao).trim().slice(0, 200),
    tipo,
    categoria || 'Outros',
    valorNum,
    data || hoje,
    origem || 'manual',
    statusVal,
    bancoIdNum,
    req.uid
  );

  const nova = db.prepare('SELECT * FROM transacoes WHERE id = ?').get(result.lastInsertRowid);
  if (global.broadcastWS) global.broadcastWS({ type: 'nova_transacao', data: nova }, req.uid);
  res.json({ ok: true, data: nova });
});

// ── PUT /:id — Editar transação existente ────────────────────────────────────
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const db = getDb();
  const existente = db.prepare('SELECT * FROM transacoes WHERE id = ? AND usuario_id = ?').get(id, req.uid);
  if (!existente) return res.status(404).json({ ok: false, erro: 'Transação não encontrada' });

  const { descricao, tipo, categoria, valor, data, banco_id } = req.body;
  const status = req.body.status;

  if (!descricao || !tipo || valor === undefined || valor === null) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: descricao, tipo, valor' });
  }
  if (!TIPOS_VALIDOS.has(tipo)) {
    return res.status(400).json({ ok: false, erro: 'Tipo inválido. Use "entrada" ou "saida"' });
  }
  const valorNum = parseFloat(valor);
  if (isNaN(valorNum) || valorNum <= 0) {
    return res.status(400).json({ ok: false, erro: 'Valor deve ser um número positivo' });
  }
  if (data && !REGEX_DATA.test(data)) {
    return res.status(400).json({ ok: false, erro: 'Formato de data inválido. Use YYYY-MM-DD' });
  }
  if (status && !STATUS_VALIDOS.has(status)) {
    return res.status(400).json({ ok: false, erro: 'Status inválido' });
  }

  const bancoIdNum = bancoDoUsuario(db, req.uid, banco_id);
  db.prepare(`
    UPDATE transacoes
    SET descricao = ?, tipo = ?, categoria = ?, valor = ?, data = ?, status = ?, banco_id = ?
    WHERE id = ? AND usuario_id = ?
  `).run(
    String(descricao).trim().slice(0, 200),
    tipo,
    categoria || 'Outros',
    valorNum,
    data || existente.data,
    status || existente.status,
    bancoIdNum,
    id,
    req.uid
  );

  const atualizada = db.prepare('SELECT * FROM transacoes WHERE id = ?').get(id);
  if (global.broadcastWS) global.broadcastWS({ type: 'editar_transacao', data: atualizada }, req.uid);
  res.json({ ok: true, data: atualizada });
});

// ── PATCH /:id/status — Atualizar status da transação ───────────────────────
router.patch('/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const { status } = req.body;
  if (!STATUS_VALIDOS.has(status)) {
    return res.status(400).json({ ok: false, erro: 'Status inválido. Use "pago", "pendente" ou "a_pagar"' });
  }

  const db = getDb();
  const resultado = db.prepare('UPDATE transacoes SET status = ? WHERE id = ? AND usuario_id = ?').run(status, id, req.uid);
  if (resultado.changes === 0) return res.status(404).json({ ok: false, erro: 'Transação não encontrada' });

  const atualizada = db.prepare('SELECT * FROM transacoes WHERE id = ?').get(id);
  if (global.broadcastWS) global.broadcastWS({ type: 'status_transacao', data: atualizada }, req.uid);
  res.json({ ok: true, data: atualizada });
});

// ── DELETE /:id — Remover transação ─────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });
  getDb().prepare('DELETE FROM transacoes WHERE id = ? AND usuario_id = ?').run(id, req.uid);
  res.json({ ok: true });
});

module.exports = router;
