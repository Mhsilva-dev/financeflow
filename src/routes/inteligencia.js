// src/routes/inteligencia.js — Painel de inteligência financeira (projeções e sugestões)
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');
const { hojeLocal } = require('../utils/datas');

// ── GET /painel — Dashboard com projeções e alertas automáticos ──────────────
router.get('/painel', (req, res) => {
  try {
    const db       = getDb();
    const uid      = req.uid;
    const hoje     = new Date();
    const hojeStr  = hojeLocal();
    const mesAtual = hojeStr.slice(0, 7);

    // Início do período de análise histórica (3 meses atrás)
    const tresAtras = new Date(hoje);
    tresAtras.setMonth(tresAtras.getMonth() - 3);
    const tresStr = tresAtras.toISOString().slice(0, 7);

    // ── Saldo atual acumulado (todas as transações) ──────────────────────────
    const saldoRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas
      FROM transacoes WHERE usuario_id = ?
    `).get(uid);
    const saldoAtual = saldoRow.entradas - saldoRow.saidas;

    // ── Despesas futuras nos próximos 30 dias ────────────────────────────────
    const em30 = new Date(hoje);
    em30.setDate(em30.getDate() + 30);
    const em30Str = em30.toISOString().slice(0, 10);

    const despesasFuturas30 = db.prepare(`
      SELECT * FROM despesas_futuras
      WHERE usuario_id = ? AND concluida=0 AND data_prevista >= ? AND data_prevista <= ?
      ORDER BY data_prevista ASC
    `).all(uid, hojeStr, em30Str);

    // ── Média diária de entradas/saídas (últimos 3 meses, excluindo mês atual) ──
    const mediaDiariaRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) / 90.0 AS entrada_dia,
        COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) / 90.0 AS saida_dia
      FROM transacoes
      WHERE usuario_id = ? AND strftime('%Y-%m', data) >= ? AND strftime('%Y-%m', data) < ?
    `).get(uid, tresStr, mesAtual);
    const entradaDia = mediaDiariaRow?.entrada_dia || 0;
    const saidaDia   = mediaDiariaRow?.saida_dia   || 0;

    // ── Média mensal de gastos (últimos 3 meses) ─────────────────────────────
    const mediaGastosMensalRow = db.prepare(`
      SELECT COALESCE(AVG(total), 0) AS media
      FROM (
        SELECT strftime('%Y-%m', data) AS mes, SUM(valor) AS total
        FROM transacoes
        WHERE usuario_id = ? AND tipo='saida'
          AND strftime('%Y-%m', data) >= ?
          AND strftime('%Y-%m', data) < ?
        GROUP BY mes
      )
    `).get(uid, tresStr, mesAtual);
    const mediaGastosMensal = mediaGastosMensalRow?.media || 0;

    // ── Projeção do gasto total do mês atual ─────────────────────────────────
    const diaAtual    = hoje.getDate();
    const totalDiasMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const gastosMesAtualRow = db.prepare(`
      SELECT COALESCE(SUM(valor), 0) AS total
      FROM transacoes WHERE usuario_id = ? AND tipo='saida' AND strftime('%Y-%m', data) = ?
    `).get(uid, mesAtual);
    const gastosMesAtual  = gastosMesAtualRow?.total || 0;
    // Extrapola o ritmo atual para o fim do mês
    const projecaoMesAtual = diaAtual > 0
      ? (gastosMesAtual / diaAtual) * totalDiasMes
      : gastosMesAtual;

    // ── Gastos do mês por categoria e comparação com média histórica ─────────
    const gastosMesAtualCats = db.prepare(`
      SELECT categoria, SUM(valor) AS total
      FROM transacoes WHERE usuario_id = ? AND tipo='saida' AND strftime('%Y-%m', data) = ?
      GROUP BY categoria ORDER BY total DESC
    `).all(uid, mesAtual);

    const mediaCatRows = db.prepare(`
      SELECT categoria, ROUND(AVG(total), 2) AS media
      FROM (
        SELECT categoria, strftime('%Y-%m', data) AS mes, SUM(valor) AS total
        FROM transacoes
        WHERE usuario_id = ? AND tipo='saida'
          AND strftime('%Y-%m', data) >= ?
          AND strftime('%Y-%m', data) < ?
        GROUP BY categoria, mes
      )
      GROUP BY categoria
    `).all(uid, tresStr, mesAtual);
    const mediaMap = Object.fromEntries(mediaCatRows.map(m => [m.categoria, m.media]));

    // ── Simulação de saldo dia a dia nos próximos 30 dias ────────────────────
    const totalDf30 = despesasFuturas30.reduce((s, d) => s + d.valor, 0);
    const dfPorDia  = {};
    despesasFuturas30.forEach(d => {
      dfPorDia[d.data_prevista] = (dfPorDia[d.data_prevista] || 0) + d.valor;
    });

    let saldoSim = saldoAtual;
    let diaRisco = null;
    const projecao30 = [];

    for (let i = 1; i <= 30; i++) {
      const d    = new Date(hoje);
      d.setDate(d.getDate() + i);
      const dStr = d.toISOString().slice(0, 10);

      saldoSim += entradaDia - saidaDia - (dfPorDia[dStr] || 0);
      projecao30.push({ data: dStr, saldo: Math.round(saldoSim * 100) / 100 });

      // Registra o primeiro dia em que o saldo ficaria negativo
      if (saldoSim < 0 && diaRisco === null) {
        diaRisco = { dias: i, data: dStr, saldo: Math.round(saldoSim * 100) / 100 };
      }
    }

    const saldoPrevisto30 = projecao30[29]?.saldo ?? saldoAtual;

    // ── Sugestões automáticas baseadas nos dados ──────────────────────────────
    const sugestoes = [];

    // Projeção do mês acima da média histórica (margem de 15%)
    if (mediaGastosMensal > 0 && projecaoMesAtual > mediaGastosMensal * 1.15) {
      const pct = Math.round((projecaoMesAtual / mediaGastosMensal - 1) * 100);
      sugestoes.push({
        icone:    '📈',
        tipo:     'projecao_mes',
        titulo:   'Projeção de gasto alta este mês',
        mensagem: `Se continuar assim, vai gastar R$ ${projecaoMesAtual.toFixed(2)} esse mês (${pct}% acima da sua média de R$ ${mediaGastosMensal.toFixed(2)})`,
        gravidade: pct > 40 ? 'alta' : 'media'
      });
    }

    // Categorias com gasto 30%+ acima da média histórica
    gastosMesAtualCats.forEach(g => {
      const media = mediaMap[g.categoria];
      if (media && g.total > media * 1.3) {
        const pct    = Math.round((g.total / media - 1) * 100);
        const excesso = g.total - media;
        sugestoes.push({
          icone:        getCatIcon(g.categoria),
          tipo:         'excesso_categoria',
          titulo:       `Você gastou muito com ${g.categoria}`,
          mensagem:     `Gasto este mês: R$ ${g.total.toFixed(2)} · Média: R$ ${media.toFixed(2)} · ${pct}% acima do normal`,
          valor_excesso: Math.round(excesso * 100) / 100,
          gravidade:    pct > 60 ? 'alta' : 'media'
        });
      }
    });

    // Aviso consolidado de despesas futuras relevantes
    if (despesasFuturas30.length > 0 && totalDf30 > 0) {
      // Ordena por valor para pegar a maior sem mutar o array original
      const maior = [...despesasFuturas30].sort((a, b) => b.valor - a.valor)[0];
      sugestoes.push({
        icone:    '📅',
        tipo:     'despesas_futuras',
        titulo:   `${despesasFuturas30.length} despesa(s) prevista(s) nos próximos 30 dias`,
        mensagem: `Total: R$ ${totalDf30.toFixed(2)} · Maior: ${maior.descricao} (R$ ${maior.valor.toFixed(2)})`,
        gravidade: 'info'
      });
    }

    res.json({
      ok: true,
      data: {
        saldoAtual:             Math.round(saldoAtual        * 100) / 100,
        saldoPrevisto30,
        totalDespesasFuturas30: Math.round(totalDf30          * 100) / 100,
        diaRisco,
        mediaGastosMensal:      Math.round(mediaGastosMensal  * 100) / 100,
        projecaoMesAtual:       Math.round(projecaoMesAtual   * 100) / 100,
        gastosMesAtual:         Math.round(gastosMesAtual     * 100) / 100,
        projecao30,
        sugestoes: sugestoes.slice(0, 6)
      }
    });

  } catch (err) {
    console.error('[Inteligencia] Erro no painel:', err.message);
    res.status(500).json({ ok: false, erro: 'Erro ao calcular painel de inteligência' });
  }
});

// Ícones por categoria — centralizado para fácil manutenção
function getCatIcon(cat) {
  const icons = {
    'Alimentação':  '🍔',
    'Moradia':      '🏠',
    'Transporte':   '🚗',
    'Saúde':        '💊',
    'Educação':     '📚',
    'Lazer':        '🎮',
    'Roupas':       '👕',
    'Serviços':     '⚙️',
    'Tecnologia':   '💻',
    'Investimentos':'💰',
    'Salário':      '💼',
  };
  return icons[cat] || '💸';
}

module.exports = router;
