// src/routes/transacoes/lote.js
// Ações que afetam várias transações de uma vez: duplicar um lançamento
// pro próximo mês, duplicar o mês inteiro, apagar o mês inteiro, ou
// marcar tudo que está pendente do mês como quitado.
const express = require('express');
const router  = express.Router();
const { getDb } = require('../../db');
const { REGEX_MES, proximoMes } = require('./helpers');

// ── POST /:id/duplicar — Duplicar transação para o próximo mês ──────────────
router.post('/:id/duplicar', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const db = getDb();
  const orig = db.prepare('SELECT * FROM transacoes WHERE id = ? AND usuario_id = ?').get(id, req.uid);
  if (!orig) return res.status(404).json({ ok: false, erro: 'Transação não encontrada' });

  const novaData = proximoMes(orig.data);
  const statusDup = orig.tipo === 'entrada' ? 'a_receber' : 'pendente';
  const result = db.prepare(`
    INSERT INTO transacoes (descricao, tipo, categoria, valor, data, origem, status, banco_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)
  `).run(orig.descricao, orig.tipo, orig.categoria, orig.valor, novaData, statusDup, orig.banco_id, req.uid);

  const nova = db.prepare('SELECT * FROM transacoes WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, data: nova, mes: novaData.slice(0, 7) });
});

// ── POST /duplicar-mes — Duplicar todas as transações de um mês ──────────────
router.post('/duplicar-mes', (req, res) => {
  const { mes } = req.body; // formato YYYY-MM
  if (!mes || !REGEX_MES.test(mes)) {
    return res.status(400).json({ ok: false, erro: 'Informe o mês no formato YYYY-MM' });
  }

  const db = getDb();
  const transacoes = db.prepare(`
    SELECT * FROM transacoes WHERE usuario_id = ? AND strftime('%Y-%m', data) = ? AND parcela_id IS NULL
  `).all(req.uid, mes);

  if (!transacoes.length) {
    return res.json({ ok: true, copiadas: 0, mes_destino: proximoMes(mes + '-01').slice(0, 7) });
  }

  const inserir = db.prepare(`
    INSERT INTO transacoes (descricao, tipo, categoria, valor, data, origem, status, banco_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)
  `);

  const copiarTudo = db.transaction((lista) => {
    for (const t of lista) {
      const st = t.tipo === 'entrada' ? 'a_receber' : 'pendente';
      inserir.run(t.descricao, t.tipo, t.categoria, t.valor, proximoMes(t.data), st, t.banco_id, req.uid);
    }
  });

  copiarTudo(transacoes);
  const mesDestino = proximoMes(mes + '-01').slice(0, 7);
  res.json({ ok: true, copiadas: transacoes.length, mes_destino: mesDestino });
});

// ── DELETE /mes — Apaga TODAS as transações de um mês de uma vez (irreversível) ─
// Inclui transações de parcelas — se o mês excluído tinha parcelas em andamento,
// o contador de parcelas pagas na tela de Parcelas pode ficar dessincronizado.
router.delete('/mes', (req, res) => {
  const { mes } = req.body; // formato YYYY-MM
  if (!mes || !REGEX_MES.test(mes)) {
    return res.status(400).json({ ok: false, erro: 'Informe o mês no formato YYYY-MM' });
  }

  const db = getDb();
  const resultado = db.prepare("DELETE FROM transacoes WHERE usuario_id = ? AND strftime('%Y-%m', data) = ?").run(req.uid, mes);

  if (global.broadcastWS) global.broadcastWS({ type: 'excluir_mes', data: { mes } }, req.uid);
  res.json({ ok: true, removidas: resultado.changes });
});

// ── PATCH /pagar-mes — Marca de uma vez todas as pendências do mês como quitadas ─
// Saídas "pendente"/"a_pagar" viram "pago"; entradas "a_receber" viram "recebido".
// Lançamentos já pagos/recebidos não são tocados (idempotente).
router.patch('/pagar-mes', (req, res) => {
  const { mes } = req.body; // formato YYYY-MM
  if (!mes || !REGEX_MES.test(mes)) {
    return res.status(400).json({ ok: false, erro: 'Informe o mês no formato YYYY-MM' });
  }

  const db = getDb();
  const atualizadas = db.transaction(() => {
    const saidas = db.prepare(`
      UPDATE transacoes SET status = 'pago'
      WHERE usuario_id = ? AND strftime('%Y-%m', data) = ? AND tipo = 'saida' AND status IN ('pendente', 'a_pagar')
    `).run(req.uid, mes);
    const entradas = db.prepare(`
      UPDATE transacoes SET status = 'recebido'
      WHERE usuario_id = ? AND strftime('%Y-%m', data) = ? AND tipo = 'entrada' AND status = 'a_receber'
    `).run(req.uid, mes);
    return saidas.changes + entradas.changes;
  })();

  if (global.broadcastWS) global.broadcastWS({ type: 'pagar_mes', data: { mes } }, req.uid);
  res.json({ ok: true, atualizadas });
});

module.exports = router;
