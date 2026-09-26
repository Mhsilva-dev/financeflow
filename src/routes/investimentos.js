// src/routes/investimentos.js — Carteira de investimentos, cotações e recomendação de IA
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');
const { mesLocal } = require('../utils/datas');
const { gerarRecomendacaoInvestimento } = require('../gemini');
const { buscarResumoMercado, buscarCotacoesCarteira } = require('../services/cotacoes');
const { bancoDoUsuario } = require('./transacoes/helpers');

const TIPOS_VALIDOS = new Set(['acao', 'fii', 'cripto', 'renda_fixa']);

// ── GET /mercado — Cotações da barra (USD, EUR, BTC, ETH, IBOV) ─────────────
router.get('/mercado', async (req, res) => {
  try {
    const data = await buscarResumoMercado();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Não foi possível buscar as cotações de mercado' });
  }
});

// Calcula valor atual e lucro/prejuízo de uma posição com base na cotação viva
function enriquecerPosicao(p, cotacoes) {
  if (p.tipo === 'renda_fixa') {
    return { ...p, preco_atual: null, variacao_pct: null, valor_atual: p.valor_aplicado, lucro: 0, lucro_pct: 0, defasado: false };
  }

  const cot = cotacoes[p.ticker];
  if (!cot) {
    return { ...p, preco_atual: null, variacao_pct: null, valor_atual: p.valor_aplicado, lucro: 0, lucro_pct: 0, defasado: true };
  }

  const valorAtual = p.quantidade * cot.preco;
  const lucro      = valorAtual - p.valor_aplicado;
  const lucroPct   = p.valor_aplicado > 0 ? (lucro / p.valor_aplicado) * 100 : 0;

  return {
    ...p,
    preco_atual:  cot.preco,
    variacao_pct: cot.variacao_pct,
    valor_atual:  valorAtual,
    lucro,
    lucro_pct:    lucroPct,
    defasado:     !!cot.defasado
  };
}

// ── GET / — Listar carteira com cotação e lucro/prejuízo em tempo real ──────
router.get('/', async (req, res) => {
  const posicoes = getDb().prepare('SELECT * FROM investimentos WHERE usuario_id = ? ORDER BY created_at DESC').all(req.uid);
  const cotacoes = await buscarCotacoesCarteira(posicoes);
  const data = posicoes.map(p => enriquecerPosicao(p, cotacoes));
  res.json({ ok: true, data });
});

// ── GET /resumo — Totais e alocação por tipo ────────────────────────────────
router.get('/resumo', async (req, res) => {
  const posicoes = getDb().prepare('SELECT * FROM investimentos WHERE usuario_id = ?').all(req.uid);
  const cotacoes = await buscarCotacoesCarteira(posicoes);
  const enriquecidas = posicoes.map(p => enriquecerPosicao(p, cotacoes));

  const investido = enriquecidas.reduce((s, p) => s + p.valor_aplicado, 0);
  const atual      = enriquecidas.reduce((s, p) => s + p.valor_atual, 0);

  const alocacao = {};
  enriquecidas.forEach(p => {
    alocacao[p.tipo] = (alocacao[p.tipo] || 0) + p.valor_atual;
  });

  res.json({
    ok: true,
    data: {
      valor_investido: investido,
      valor_atual:     atual,
      lucro:           atual - investido,
      lucro_pct:       investido > 0 ? ((atual - investido) / investido) * 100 : 0,
      alocacao
    }
  });
});

// ── POST / — Cadastrar posição na carteira ──────────────────────────────────
router.post('/', (req, res) => {
  const { tipo, ticker, nome, quantidade, preco_medio, valor_aplicado, rentabilidade_info, vencimento, banco_id } = req.body;

  if (!TIPOS_VALIDOS.has(tipo)) {
    return res.status(400).json({ ok: false, erro: 'Tipo inválido. Use acao, fii, cripto ou renda_fixa' });
  }
  if (!nome) {
    return res.status(400).json({ ok: false, erro: 'Campo obrigatório: nome' });
  }
  if (tipo !== 'renda_fixa' && !ticker) {
    return res.status(400).json({ ok: false, erro: 'Ticker é obrigatório para ações, FIIs e criptomoedas' });
  }
  if (ticker && !/^[A-Za-z0-9.-]{1,15}$/.test(String(ticker).trim())) {
    return res.status(400).json({ ok: false, erro: 'Ticker inválido (use só letras e números, ex: PETR4, BTC)' });
  }

  const qtd   = parseFloat(quantidade) || 0;
  const preco = parseFloat(preco_medio) || 0;
  const valorAplicadoNum = valor_aplicado !== undefined && valor_aplicado !== null
    ? parseFloat(valor_aplicado) || 0
    : qtd * preco;
  const db = getDb();
  const bancoIdNum = bancoDoUsuario(db, req.uid, banco_id);

  const result = db.prepare(`
    INSERT INTO investimentos (tipo, ticker, nome, quantidade, preco_medio, valor_aplicado, rentabilidade_info, vencimento, banco_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tipo,
    ticker ? String(ticker).trim().toUpperCase().slice(0, 20) : null,
    String(nome).trim().slice(0, 150),
    qtd,
    preco,
    valorAplicadoNum,
    rentabilidade_info || null,
    vencimento || null,
    bancoIdNum,
    req.uid
  );

  res.json({ ok: true, data: db.prepare('SELECT * FROM investimentos WHERE id = ?').get(result.lastInsertRowid) });
});

// ── PATCH /:id — Editar posição ──────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const db = getDb();
  const existente = db.prepare('SELECT * FROM investimentos WHERE id = ? AND usuario_id = ?').get(id, req.uid);
  if (!existente) return res.status(404).json({ ok: false, erro: 'Investimento não encontrado' });

  const { nome, quantidade, preco_medio, valor_aplicado, rentabilidade_info, vencimento, banco_id } = req.body;
  if (!nome) return res.status(400).json({ ok: false, erro: 'Campo obrigatório: nome' });

  const qtd   = parseFloat(quantidade) || 0;
  const preco = parseFloat(preco_medio) || 0;
  const valorAplicadoNum = valor_aplicado !== undefined && valor_aplicado !== null
    ? parseFloat(valor_aplicado) || 0
    : qtd * preco;
  const bancoIdNum = bancoDoUsuario(db, req.uid, banco_id);

  db.prepare(`
    UPDATE investimentos
    SET nome = ?, quantidade = ?, preco_medio = ?, valor_aplicado = ?, rentabilidade_info = ?, vencimento = ?, banco_id = ?
    WHERE id = ? AND usuario_id = ?
  `).run(
    String(nome).trim().slice(0, 150),
    qtd,
    preco,
    valorAplicadoNum,
    rentabilidade_info || null,
    vencimento || null,
    bancoIdNum,
    id,
    req.uid
  );

  res.json({ ok: true, data: db.prepare('SELECT * FROM investimentos WHERE id = ?').get(id) });
});

// ── DELETE /:id — Remover posição ────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' });

  const info = getDb().prepare('DELETE FROM investimentos WHERE id = ? AND usuario_id = ?').run(id, req.uid);
  if (info.changes === 0) return res.status(404).json({ ok: false, erro: 'Investimento não encontrado' });

  res.json({ ok: true });
});

// ── POST /recomendacao — Sugestão de IA baseada no perfil real + carteira ───
router.post('/recomendacao', async (req, res) => {
  const db  = getDb();
  const mes = mesLocal();

  const doMes = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo='saida'   THEN valor ELSE 0 END), 0) AS saidas
    FROM transacoes WHERE usuario_id = ? AND strftime('%Y-%m', data) = ?
  `).get(req.uid, mes);

  const cats = db.prepare(`
    SELECT categoria, SUM(valor) AS total FROM transacoes
    WHERE usuario_id = ? AND tipo='saida' AND strftime('%Y-%m', data) = ?
    GROUP BY categoria ORDER BY total DESC LIMIT 5
  `).all(req.uid, mes);

  const saldoLivre    = doMes.entradas - doMes.saidas;
  const taxaPoupanca  = doMes.entradas > 0 ? Math.round((saldoLivre / doMes.entradas) * 100) : 0;

  const posicoes = db.prepare('SELECT tipo, ticker, nome, quantidade, valor_aplicado FROM investimentos WHERE usuario_id = ?').all(req.uid);
  const cotacoesCarteira = await buscarCotacoesCarteira(posicoes);
  const mercado = await buscarResumoMercado();

  const perfil = {
    saldoLivre:    saldoLivre.toFixed(2),
    taxaPoupanca,
    categorias:    Object.fromEntries(cats.map(c => [c.categoria, Number(c.total).toFixed(2)]))
  };

  const recomendacao = await gerarRecomendacaoInvestimento(perfil, posicoes, { ...cotacoesCarteira, mercado });

  if (!recomendacao) {
    return res.status(503).json({ ok: false, erro: 'IA indisponível no momento. Tente novamente em instantes.' });
  }

  res.json({ ok: true, data: recomendacao });
});

module.exports = router;
