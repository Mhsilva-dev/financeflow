// src/services/cotacoes.js — Cotações de mercado em tempo real (ações/FIIs, câmbio, cripto)
// Fontes gratuitas, sem chave: brapi.dev (B3), CoinGecko (cripto), AwesomeAPI/Frankfurter (câmbio)
const axios = require('axios');
const { getDb } = require('../db');

const TTL_MS = 60 * 1000; // 1 minuto — evita bater na API a cada requisição da UI
const _memCache = new Map(); // simbolo -> { preco, variacao_pct, ts }

const CRIPTO_IDS = { BTC: 'bitcoin', ETH: 'ethereum' };

function _doCache(simbolo) {
  const c = _memCache.get(simbolo);
  if (c && Date.now() - c.ts < TTL_MS) return c;
  return null;
}

function _salvarMemCache(simbolo, preco, variacao_pct) {
  _memCache.set(simbolo, { preco, variacao_pct, ts: Date.now() });
}

// Persiste último valor bom conhecido — usado quando a API externa está fora do ar
function _salvarDbCache(simbolo, preco, variacao_pct) {
  try {
    getDb().prepare(`
      INSERT INTO cotacoes_cache (simbolo, preco, variacao_pct, atualizado_em)
      VALUES (?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(simbolo) DO UPDATE SET preco=excluded.preco, variacao_pct=excluded.variacao_pct, atualizado_em=excluded.atualizado_em
    `).run(simbolo, preco, variacao_pct);
  } catch (_) {}
}

function _lerDbCache(simbolo) {
  try {
    const row = getDb().prepare('SELECT * FROM cotacoes_cache WHERE simbolo = ?').get(simbolo);
    if (!row) return null;
    return { preco: row.preco, variacao_pct: row.variacao_pct, atualizado_em: row.atualizado_em, defasado: true };
  } catch (_) {
    return null;
  }
}

// ── Ações e FIIs (B3) via brapi.dev ─────────────────────────────────────────
async function buscarAcoes(tickers) {
  if (!tickers.length) return {};

  const naoCacheados = tickers.filter(t => !_doCache(t));
  const resultado = {};

  tickers.forEach(t => {
    const c = _doCache(t);
    if (c) resultado[t] = { preco: c.preco, variacao_pct: c.variacao_pct };
  });

  if (naoCacheados.length) {
    try {
      const validos = naoCacheados.filter(t => /^[A-Z0-9.-]{1,15}$/.test(t));
      if (!validos.length) throw new Error('sem tickers válidos');
      const { data } = await axios.get(`https://brapi.dev/api/quote/${validos.map(encodeURIComponent).join(',')}`, { timeout: 8000 });
      (data.results || []).forEach(r => {
        resultado[r.symbol] = { preco: r.regularMarketPrice, variacao_pct: r.regularMarketChangePercent };
        _salvarMemCache(r.symbol, r.regularMarketPrice, r.regularMarketChangePercent);
        _salvarDbCache(r.symbol, r.regularMarketPrice, r.regularMarketChangePercent);
      });
    } catch (err) {
      naoCacheados.forEach(t => {
        if (!resultado[t]) {
          const cache = _lerDbCache(t);
          if (cache) resultado[t] = cache;
        }
      });
    }
  }

  return resultado;
}

// ── Criptomoedas via CoinGecko ───────────────────────────────────────────────
async function buscarCripto(simbolos) {
  const ids = simbolos.map(s => CRIPTO_IDS[s]).filter(Boolean);
  if (!ids.length) return {};

  const naoCacheados = simbolos.filter(s => CRIPTO_IDS[s] && !_doCache(s));
  const resultado = {};

  simbolos.forEach(s => {
    const c = _doCache(s);
    if (c) resultado[s] = { preco: c.preco, variacao_pct: c.variacao_pct };
  });

  if (naoCacheados.length) {
    try {
      const idsBusca = naoCacheados.map(s => CRIPTO_IDS[s]).join(',');
      const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: idsBusca, vs_currencies: 'brl', include_24hr_change: true },
        timeout: 8000
      });
      naoCacheados.forEach(s => {
        const info = data[CRIPTO_IDS[s]];
        if (!info) return;
        const preco = info.brl;
        const variacao = info.brl_24h_change || 0;
        resultado[s] = { preco, variacao_pct: variacao };
        _salvarMemCache(s, preco, variacao);
        _salvarDbCache(s, preco, variacao);
      });
    } catch (err) {
      naoCacheados.forEach(s => {
        if (!resultado[s]) {
          const cache = _lerDbCache(s);
          if (cache) resultado[s] = cache;
        }
      });
    }
  }

  return resultado;
}

// ── Câmbio (USD/EUR → BRL) — AwesomeAPI com fallback para Frankfurter ────────
async function buscarCambio() {
  const simbolos = ['USD', 'EUR'];
  const cacheados = simbolos.filter(s => _doCache(s));
  const resultado = {};
  cacheados.forEach(s => {
    const c = _doCache(s);
    resultado[s] = { preco: c.preco, variacao_pct: c.variacao_pct };
  });

  const faltantes = simbolos.filter(s => !_doCache(s));
  if (!faltantes.length) return resultado;

  try {
    const { data } = await axios.get('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL', { timeout: 8000 });
    if (data.USDBRL) {
      resultado.USD = { preco: parseFloat(data.USDBRL.bid), variacao_pct: parseFloat(data.USDBRL.pctChange) };
      _salvarMemCache('USD', resultado.USD.preco, resultado.USD.variacao_pct);
      _salvarDbCache('USD', resultado.USD.preco, resultado.USD.variacao_pct);
    }
    if (data.EURBRL) {
      resultado.EUR = { preco: parseFloat(data.EURBRL.bid), variacao_pct: parseFloat(data.EURBRL.pctChange) };
      _salvarMemCache('EUR', resultado.EUR.preco, resultado.EUR.variacao_pct);
      _salvarDbCache('EUR', resultado.EUR.preco, resultado.EUR.variacao_pct);
    }
    return resultado;
  } catch (err) {
    // Fallback: Frankfurter (taxas diárias do BCE, sem chave, sem variação %)
    try {
      const { data } = await axios.get('https://api.frankfurter.dev/v1/latest', {
        params: { from: 'USD', to: 'BRL,EUR' }, timeout: 8000
      });
      if (!resultado.USD) {
        resultado.USD = { preco: data.rates.BRL, variacao_pct: 0 };
        _salvarDbCache('USD', data.rates.BRL, 0);
      }
      if (!resultado.EUR && data.rates.EUR) {
        const eurBrl = data.rates.BRL / data.rates.EUR;
        resultado.EUR = { preco: eurBrl, variacao_pct: 0 };
        _salvarDbCache('EUR', eurBrl, 0);
      }
    } catch (err2) {
      faltantes.forEach(s => {
        if (!resultado[s]) {
          const cache = _lerDbCache(s);
          if (cache) resultado[s] = cache;
        }
      });
    }
    return resultado;
  }
}

// ── Resumo de mercado para a barra de cotações do dashboard ─────────────────
// Obs: índice Ibovespa (^BVSP) exige token pago no brapi.dev — fora do escopo
// gratuito, por isso a barra cobre câmbio + cripto, que são de graça e sem limite de conta.
async function buscarResumoMercado() {
  const [cambio, cripto] = await Promise.all([
    buscarCambio(),
    buscarCripto(['BTC', 'ETH'])
  ]);

  return {
    USD: cambio.USD || null,
    EUR: cambio.EUR || null,
    BTC: cripto.BTC || null,
    ETH: cripto.ETH || null
  };
}

// Busca cotação de qualquer ticker/símbolo da carteira, roteando pela fonte certa
async function buscarCotacoesCarteira(posicoes) {
  const tickersAcoes = posicoes.filter(p => (p.tipo === 'acao' || p.tipo === 'fii') && p.ticker).map(p => p.ticker);
  const tickersCripto = posicoes.filter(p => p.tipo === 'cripto' && p.ticker).map(p => p.ticker.toUpperCase());

  const [acoes, cripto] = await Promise.all([
    buscarAcoes([...new Set(tickersAcoes)]),
    buscarCripto([...new Set(tickersCripto)])
  ]);

  return { ...acoes, ...cripto };
}

module.exports = { buscarAcoes, buscarCripto, buscarCambio, buscarResumoMercado, buscarCotacoesCarteira };
