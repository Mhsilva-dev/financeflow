// src/routes/transacoes/listagem.js
// Rotas de leitura: listar transações (com filtros), exportar a mesma
// lista em PDF, e os totais/saldo usados pelo dashboard.
const express = require('express');
const router  = express.Router();
const { getDb } = require('../../db');
const { hojeLocal, mesLocal } = require('../../utils/datas');
const { gerarPDFTransacoes } = require('../../utils/transacoesPDF');
const { REGEX_MES, montarQueryTransacoes } = require('./helpers');

// ── GET / — Listar transações com filtros opcionais ──────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { erro, sql, params } = montarQueryTransacoes(req.query, req.uid);
  if (erro) return res.status(400).json({ ok: false, erro });

  res.json({ ok: true, data: db.prepare(sql).all(...params) });
});

// ── GET /pdf — Exporta a lista de transações filtrada em PDF ─────────────────
router.get('/pdf', async (req, res) => {
  const db = getDb();
  const { erro, sql, params, filtros } = montarQueryTransacoes(req.query, req.uid);
  if (erro) return res.status(400).json({ ok: false, erro });

  try {
    const lista = db.prepare(sql).all(...params);
    const pdfBuffer = await gerarPDFTransacoes(lista, filtros);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="transacoes-${hojeLocal()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Transações] Erro ao gerar PDF:', err);
    res.status(err.status === 429 ? 429 : 500).json({ ok: false, erro: err.status === 429 ? err.message : 'Não foi possível gerar o PDF. Tente novamente.' });
  }
});

// ── GET /totais — Totais, saldo anterior e histórico para o dashboard ────────
router.get('/totais', (req, res) => {
  const db  = getDb();
  const { mes } = req.query;

  if (mes && !REGEX_MES.test(mes)) {
    return res.status(400).json({ ok: false, erro: 'Formato de mês inválido. Use YYYY-MM' });
  }

  const comFiltroMes = mes ? "AND strftime('%Y-%m', data) = ?" : '';
  const paramMes     = mes ? [req.uid, mes] : [req.uid];

  // Totais do mês (todas as transações, independente de status)
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas,
      COUNT(*) AS total
    FROM transacoes WHERE usuario_id = ? ${comFiltroMes}
  `).get(...paramMes);

  // Saldo anterior — soma confirmada de todos os meses ANTES do mês atual.
  // Confirmado = entrada 'recebido'/'pago' + saida 'pago' + registros legados (NULL).
  // Isso garante que apenas dinheiro real entre no cálculo de carry-forward.
  let saldo_anterior = 0;
  if (mes) {
    const rowAnt = db.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN tipo='entrada' AND (status IN ('recebido','pago') OR status IS NULL) THEN  valor
          WHEN tipo='saida'   AND (status = 'pago'               OR status IS NULL) THEN -valor
          ELSE 0
        END
      ), 0) AS saldo
      FROM transacoes
      WHERE usuario_id = ? AND strftime('%Y-%m', data) < ?
    `).get(req.uid, mes);
    saldo_anterior = rowAnt.saldo;
  }

  const categorias = db.prepare(`
    SELECT categoria, SUM(valor) AS total
    FROM transacoes WHERE usuario_id = ? AND tipo='saida' ${comFiltroMes}
    GROUP BY categoria ORDER BY total DESC
  `).all(...paramMes);

  // Últimos 6 meses até o mês exibido — sem isso, parcelas futuras empurravam o gráfico para meses que ainda não chegaram
  const historico = db.prepare(`
    SELECT strftime('%Y-%m', data) AS mes,
      SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) AS entradas,
      SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END) AS saidas
    FROM transacoes WHERE usuario_id = ? AND strftime('%Y-%m', data) <= ?
    GROUP BY mes ORDER BY mes DESC LIMIT 6
  `).all(req.uid, mes || mesLocal()).reverse();

  const saldo_mes        = row.entradas - row.saidas;
  const saldo_acumulado  = saldo_anterior + saldo_mes;

  res.json({
    ok: true,
    data: {
      ...row,
      saldo: saldo_mes,
      saldo_anterior,
      saldo_acumulado,
      categorias,
      historico
    }
  });
});

module.exports = router;
