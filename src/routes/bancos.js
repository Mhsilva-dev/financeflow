// src/routes/bancos.js — Gestão de contas bancárias
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');

// ── GET / — Listar bancos cadastrados (com contagem de transações) ──────────
router.get('/', (req, res) => {
  const data = getDb().prepare(`
    SELECT b.*, COUNT(t.id) AS total_transacoes
    FROM bancos b
    LEFT JOIN transacoes t ON t.banco_id = b.id AND t.usuario_id = b.usuario_id
    WHERE b.usuario_id = ?
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `).all(req.uid);
  res.json({ ok: true, data });
});

// ── GET /:id — Detalhes de um banco ──────────────────────────────────────────
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const banco = getDb().prepare('SELECT * FROM bancos WHERE id = ? AND usuario_id = ?').get(id, req.uid);
  if (!banco) return res.status(404).json({ ok: false, erro: 'Banco não encontrado' });

  res.json({ ok: true, data: banco });
});

// ── POST / — Cadastrar novo banco ────────────────────────────────────────────
router.post('/', (req, res) => {
  const { nome, agencia, conta, saldo, cor, titular } = req.body;

  if (!nome) {
    return res.status(400).json({ ok: false, erro: 'Campo obrigatório: nome' });
  }

  const saldoNum = parseFloat(saldo) || 0;
  const db     = getDb();
  const result = db.prepare(`
    INSERT INTO bancos (nome, agencia, conta, saldo, cor, titular, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(nome).trim().slice(0, 100),
    agencia || '0001',
    conta   || '****',
    saldoNum,
    cor     || '#8a9ab5',
    titular || 'Você',
    req.uid
  );

  res.json({ ok: true, data: db.prepare('SELECT * FROM bancos WHERE id = ?').get(result.lastInsertRowid) });
});

// ── PATCH /:id — Editar dados cadastrais do banco ────────────────────────────
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const { nome, agencia, conta, cor, titular } = req.body;
  if (!nome) return res.status(400).json({ ok: false, erro: 'Campo obrigatório: nome' });

  const db = getDb();
  const existe = db.prepare('SELECT id FROM bancos WHERE id = ? AND usuario_id = ?').get(id, req.uid);
  if (!existe) return res.status(404).json({ ok: false, erro: 'Banco não encontrado' });

  db.prepare(`
    UPDATE bancos SET nome = ?, agencia = ?, conta = ?, cor = ?, titular = ? WHERE id = ? AND usuario_id = ?
  `).run(
    String(nome).trim().slice(0, 100),
    agencia || '0001',
    conta   || '****',
    cor     || '#8a9ab5',
    titular || 'Você',
    id,
    req.uid
  );

  res.json({ ok: true, data: db.prepare('SELECT * FROM bancos WHERE id = ?').get(id) });
});

// ── PATCH /:id/saldo — Atualizar saldo do banco ──────────────────────────────
router.patch('/:id/saldo', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const saldo = parseFloat(req.body.saldo);
  if (isNaN(saldo)) return res.status(400).json({ ok: false, erro: 'Saldo inválido' });

  const info = getDb().prepare('UPDATE bancos SET saldo = ? WHERE id = ? AND usuario_id = ?').run(saldo, id, req.uid);
  if (info.changes === 0) return res.status(404).json({ ok: false, erro: 'Banco não encontrado' });
  res.json({ ok: true });
});

// ── DELETE /:id — Remover banco (bloqueado se houver transações vinculadas) ──
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const db = getDb();
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM transacoes WHERE banco_id = ? AND usuario_id = ?').get(id, req.uid);
  if (total > 0) {
    return res.status(409).json({ ok: false, erro: `Não é possível excluir: ${total} transação(ões) vinculada(s) a este banco.` });
  }

  const info = db.prepare('DELETE FROM bancos WHERE id = ? AND usuario_id = ?').run(id, req.uid);
  if (info.changes === 0) return res.status(404).json({ ok: false, erro: 'Banco não encontrado' });

  res.json({ ok: true });
});

module.exports = router;
