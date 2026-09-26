// src/routes/relatorio.js — Relatórios e comparativos financeiros
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');
const { hojeLocal } = require('../utils/datas');
const { gerarPDFRelatorio } = require('../utils/relatorioPDF');

// Períodos válidos — whitelist explícita para evitar valores inesperados
const PERIODOS_VALIDOS = new Set(['dia', 'semana', 'mes', 'total']);

// Retorna cláusula WHERE (hardcoded — sem interpolação de input do usuário)
function getDateFilter(periodo) {
  if (periodo === 'dia')    return { sql: "AND date(data) = date('now')",             params: [] };
  if (periodo === 'semana') return { sql: "AND data >= date('now', '-6 days')",       params: [] };
  if (periodo === 'mes')    return { sql: "AND strftime('%Y-%m', data) = strftime('%Y-%m', 'now')", params: [] };
  return { sql: '', params: [] };
}

// ── GET /comparacao — Evolução agrupada por período ──────────────────────────
router.get('/comparacao', (req, res) => {
  const db      = getDb();
  const periodo = req.query.periodo || 'total';

  if (!PERIODOS_VALIDOS.has(periodo)) {
    return res.status(400).json({ ok: false, erro: 'Período inválido. Use: dia, semana, mes ou total' });
  }

  let rows;

  if (periodo === 'dia') {
    rows = db.prepare(`
      SELECT date(data) AS mes,
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas
      FROM transacoes
      WHERE usuario_id = ? AND data >= date('now', '-6 days')
      GROUP BY date(data) ORDER BY date(data) ASC
    `).all(req.uid);

  } else if (periodo === 'semana') {
    rows = db.prepare(`
      SELECT strftime('%Y-W%W', data) AS mes,
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas
      FROM transacoes
      WHERE usuario_id = ? AND data >= date('now', '-55 days')
      GROUP BY strftime('%Y-W%W', data) ORDER BY mes ASC
    `).all(req.uid);

  } else {
    // 'mes' ou 'total' → agrupa por mês, últimos 12
    rows = db.prepare(`
      SELECT strftime('%Y-%m', data) AS mes,
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas
      FROM transacoes WHERE usuario_id = ?
      GROUP BY mes ORDER BY mes DESC LIMIT 12
    `).all(req.uid).reverse();
  }

  res.json({ ok: true, data: rows });
});

// Monta os dados do relatório (usado tanto pelo JSON quanto pelo PDF, pra nunca divergir)
function montarRelatorio(db, uid, periodo) {
  const { sql: df } = getDateFilter(periodo);

  const totais = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas,
      COUNT(*) AS total_transacoes
    FROM transacoes WHERE usuario_id = ? ${df}
  `).get(uid);

  const porCategoria = db.prepare(`
    SELECT categoria, tipo, SUM(valor) AS total, COUNT(*) AS qtd
    FROM transacoes WHERE usuario_id = ? ${df}
    GROUP BY categoria, tipo ORDER BY total DESC
  `).all(uid);

  const porMes = db.prepare(`
    SELECT strftime('%Y-%m', data) AS mes,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas
    FROM transacoes WHERE usuario_id = ? ${df}
    GROUP BY mes ORDER BY mes DESC LIMIT 12
  `).all(uid);

  const saldo         = totais.entradas - totais.saidas;
  const taxaPoupanca  = totais.entradas > 0
    ? ((saldo / totais.entradas) * 100).toFixed(1)
    : 0;

  return { totais: { ...totais, saldo }, porCategoria, porMes, taxaPoupanca };
}

// ── GET / — Relatório principal com filtro de período ────────────────────────
router.get('/', (req, res) => {
  const db      = getDb();
  const periodo = req.query.periodo || 'total';

  if (!PERIODOS_VALIDOS.has(periodo)) {
    return res.status(400).json({ ok: false, erro: 'Período inválido. Use: dia, semana, mes ou total' });
  }

  res.json({ ok: true, data: montarRelatorio(db, req.uid, periodo) });
});

// ── GET /pdf — Exporta o relatório do período em PDF ──────────────────────────
router.get('/pdf', async (req, res) => {
  const db      = getDb();
  const periodo = req.query.periodo || 'total';

  if (!PERIODOS_VALIDOS.has(periodo)) {
    return res.status(400).json({ ok: false, erro: 'Período inválido. Use: dia, semana, mes ou total' });
  }

  try {
    const dados = montarRelatorio(db, req.uid, periodo);
    const pdfBuffer = await gerarPDFRelatorio(dados, periodo);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${periodo}-${hojeLocal()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Relatório] Erro ao gerar PDF:', err);
    res.status(err.status === 429 ? 429 : 500).json({ ok: false, erro: err.status === 429 ? err.message : 'Não foi possível gerar o PDF. Tente novamente.' });
  }
});

module.exports = router;
