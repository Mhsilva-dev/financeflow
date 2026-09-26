// src/routes/parcelas.js — Gestão de compras parceladas
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');
const { hojeLocal } = require('../utils/datas');

// Calcula a data de vencimento de uma parcela, respeitando o último dia do mês.
// Ex: parcela de dia 31 em fevereiro → vira dia 28 (ou 29 em bissexto).
function dataParcela(dataInicio, indice) {
  const base      = new Date(dataInicio + 'T12:00:00');
  const totalMeses = base.getMonth() + indice;
  const ano       = base.getFullYear() + Math.floor(totalMeses / 12);
  const mes       = totalMeses % 12;
  // Clamp: garante que o dia não ultrapasse o último dia do mês destino
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const dia       = Math.min(base.getDate(), ultimoDia);
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// ── GET / — Listar todas as parcelas ────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  res.json({ ok: true, data: db.prepare('SELECT * FROM parcelas WHERE usuario_id = ? ORDER BY created_at DESC').all(req.uid) });
});

// ── POST / — Criar parcela e gerar transações automáticas ───────────────────
router.post('/', (req, res) => {
  const db = getDb();
  const { descricao, valor_total, num_parcelas, categoria, data_inicio } = req.body;

  // Validações
  if (!descricao || valor_total === undefined || num_parcelas === undefined) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: descricao, valor_total, num_parcelas' });
  }

  const total = parseFloat(valor_total);
  const num   = parseInt(num_parcelas, 10);

  if (isNaN(total) || total <= 0) {
    return res.status(400).json({ ok: false, erro: 'valor_total deve ser um número positivo' });
  }
  if (isNaN(num) || num < 1 || num > 360) {
    return res.status(400).json({ ok: false, erro: 'num_parcelas deve ser entre 1 e 360' });
  }

  // Arredonda para evitar acúmulo de erro de ponto flutuante (ex: R$ 0.333333...)
  const mensal = Math.round((total / num) * 100) / 100;
  const cat    = categoria || 'Outros';
  const inicio = data_inicio || hojeLocal();

  // Usa uma transaction SQLite para garantir atomicidade:
  // ou grava tudo (parcela + N transações), ou não grava nada
  const inserirTudo = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO parcelas (descricao, valor_total, num_parcelas, parcelas_pagas, categoria, data_inicio, usuario_id)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(String(descricao).trim().slice(0, 200), total, num, cat, inicio, req.uid);

    const parcelaId  = result.lastInsertRowid;
    const insertTrans = db.prepare(`
      INSERT INTO transacoes (descricao, tipo, categoria, valor, data, origem, parcela_id, usuario_id)
      VALUES (?, 'saida', ?, ?, ?, 'parcela', ?, ?)
    `);

    for (let i = 0; i < num; i++) {
      const dataVenc = dataParcela(inicio, i);
      insertTrans.run(`${descricao} (${i + 1}/${num})`, cat, mensal, dataVenc, parcelaId, req.uid);
    }

    return parcelaId;
  });

  const parcelaId = inserirTudo();
  res.json({ ok: true, data: db.prepare('SELECT * FROM parcelas WHERE id = ?').get(parcelaId) });
});

// ── PATCH /:id/pagar — Incrementar contador de parcelas pagas ───────────────
router.patch('/:id/pagar', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const p = db.prepare('SELECT * FROM parcelas WHERE id = ? AND usuario_id = ?').get(id, req.uid);
  if (!p) return res.status(404).json({ ok: false, erro: 'Parcela não encontrada' });

  if (p.parcelas_pagas < p.num_parcelas) {
    db.prepare('UPDATE parcelas SET parcelas_pagas = parcelas_pagas + 1 WHERE id = ?').run(id);
  }

  res.json({ ok: true });
});

// ── DELETE /:id — Remover parcela e transações futuras vinculadas ────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const hoje = hojeLocal();

  // Remove apenas transações futuras para preservar o histórico já pago
  const p = db.prepare('SELECT id FROM parcelas WHERE id = ? AND usuario_id = ?').get(id, req.uid);
  if (!p) return res.status(404).json({ ok: false, erro: 'Parcela não encontrada' });

  db.transaction(() => {
    db.prepare("DELETE FROM transacoes WHERE parcela_id = ? AND usuario_id = ? AND data >= ?").run(id, req.uid, hoje);
    db.prepare('DELETE FROM parcelas WHERE id = ? AND usuario_id = ?').run(id, req.uid);
  })();

  res.json({ ok: true });
});

module.exports = router;
