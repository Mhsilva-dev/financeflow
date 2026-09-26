// src/routes/ia.js — Assistente financeiro IA e dicas personalizadas
const express = require('express');
const router  = express.Router();
const { gerarDicasPersonalizadas } = require('../gemini');
const { getDb } = require('../db');
const { exigirAdmin } = require('../middleware/auth');

const { conversarComFerramentas } = require('../gemini');
const assistente = require('../services/assistente');

const fmtR = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Responde perguntas comuns direto do banco quando a IA está indisponível —
// sempre sobre o mês citado na pergunta (ou o mês que está na tela).
function responderSemIA(uid, mensagem, mesTela) {
  const db = getDb();
  const t = (mensagem || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const aviso = '_O assistente de IA está indisponível agora — segue o resumo direto dos seus dados._\n\n';

  if (/total geral|desde o comeco|no total|patrimonio|todos os meses/.test(t)) {
    const g = assistente.resumoGeral(db, uid);
    return aviso + `**Total geral** (${g.periodo_com_lancamentos})\n- Entradas: ${fmtR(g.entradas_totais)}\n- Saídas: ${fmtR(g.saidas_totais)}\n- Saldo: **${fmtR(g.saldo_total)}**`;
  }

  const mes = assistente.mesDoTexto(mensagem, mesTela);
  const r = assistente.resumoMes(db, uid, { mes });
  if (!r.tem_lancamentos) return aviso + `Não há lançamentos em **${r.mes_nome}**.`;

  if (/categoria|onde gastei|onde mais|gasto por/.test(t)) {
    return aviso + `**Gastos por categoria — ${r.mes_nome}**\n` +
      r.gastos_por_categoria.map(c => `- ${c.categoria}: ${fmtR(c.total)} (${c.pct_das_saidas}%)`).join('\n');
  }
  return aviso + `**${r.mes_nome}**\n- Entradas: ${fmtR(r.entradas)}\n- Saídas: ${fmtR(r.saidas)}\n- Saldo do mês: **${fmtR(r.saldo_do_mes)}**` +
    (r.detalhe_saidas.a_pagar ? `\n- Ainda a pagar: ${fmtR(r.detalhe_saidas.a_pagar)}` : '') +
    (r.detalhe_entradas.a_receber ? `\n- Ainda a receber: ${fmtR(r.detalhe_entradas.a_receber)}` : '');
}

// Histórico vindo do navegador → formato do Gemini (alternando user/model, começando por user)
function prepararHistorico(historico) {
  if (!Array.isArray(historico)) return [];
  const itens = historico.slice(-12)
    .filter(h => h && (h.role === 'user' || h.role === 'model') && typeof h.texto === 'string' && h.texto.trim())
    .map(h => ({ role: h.role, parts: [{ text: h.texto.trim().slice(0, 2000) }] }));

  const alternado = [];
  for (const h of itens) {
    const ultimo = alternado[alternado.length - 1];
    if (ultimo && ultimo.role === h.role) ultimo.parts[0].text += '\n' + h.parts[0].text;
    else alternado.push(h);
  }
  while (alternado.length && alternado[0].role !== 'user') alternado.shift();
  if (alternado.length && alternado[alternado.length - 1].role === 'user') alternado.pop();
  return alternado;
}

// ── POST /chat — Conversa com o assistente; a IA consulta os dados que precisar ──
router.post('/chat', async (req, res) => {
  const mensagem = String(req.body.mensagem || '').trim().slice(0, 1000);
  if (!mensagem) return res.status(400).json({ ok: false, erro: 'Mensagem obrigatória' });

  const mesTela = assistente.REGEX_MES.test(req.body.mes || '') ? req.body.mes : assistente.hojeBR().slice(0, 7);

  try {
    const { texto, consultas } = await conversarComFerramentas({
      sistema: assistente.instrucoesSistema({ nome: req.session.nome, mesTela }),
      historico: prepararHistorico(req.body.historico),
      mensagem,
      declaracoes: assistente.DECLARACOES,
      executar: (nome, args) => assistente.executarFerramenta(req.uid, nome, args)
    });
    if (!texto || !texto.trim()) throw new Error('resposta vazia');
    res.json({ ok: true, resposta: texto.trim(), consultas: consultas.map(c => c.nome) });
  } catch (err) {
    console.error('[IA] Chat sem IA, usando resposta direta:', (err.message || '').slice(0, 160));
    res.json({ ok: true, resposta: responderSemIA(req.uid, mensagem, mesTela), sem_ia: true });
  }
});

// ── GET /dicas?mes=YYYY-MM — Dicas da IA com base no mês informado ───────────
router.get('/dicas', async (req, res) => {
  const mes = assistente.REGEX_MES.test(req.query.mes || '') ? req.query.mes : assistente.hojeBR().slice(0, 7);
  const r = assistente.resumoMes(getDb(), req.uid, { mes });
  const parcelas = getDb().prepare(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(valor_total / num_parcelas), 0) AS mensal
    FROM parcelas WHERE usuario_id = ? AND parcelas_pagas < num_parcelas
  `).get(req.uid);

  const dicas = await gerarDicasPersonalizadas({
    entradas:      r.entradas,
    categorias:    Object.fromEntries(r.gastos_por_categoria.map(c => [c.categoria, c.total])),
    taxaPoupanca:  r.entradas > 0 ? Math.round(r.saldo_do_mes / r.entradas * 100) : 0,
    parcelas:      parcelas.cnt,
    totalParcelas: parcelas.mensal
  });
  res.json({ ok: true, mes, data: dicas });
});

// ── GET /tokens — Uso e cota do Gemini API com status em tempo real ──────────
// Uso é global (a chave da API é uma só), então só a conta administradora vê.
router.get('/tokens', exigirAdmin, (req, res) => {
  const db = getDb();

  const usoDia = db.prepare(`
    SELECT COUNT(*) AS reqs, COALESCE(SUM(tokens), 0) AS tokens
    FROM gemini_uso WHERE date(created_at) = date('now')
  `).get();

  const usoMinuto = db.prepare(`
    SELECT COUNT(*) AS reqs, COALESCE(SUM(tokens), 0) AS tokens
    FROM gemini_uso WHERE created_at >= datetime('now', '-1 minute')
  `).get();

  const historico = db.prepare(`
    SELECT date(created_at) AS dia, COUNT(*) AS reqs, SUM(tokens) AS tokens
    FROM gemini_uso
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY dia ORDER BY dia DESC
  `).all();

  // Erros de hoje agrupados por tipo
  const errosHoje = db.prepare(`
    SELECT tipo_erro, COUNT(*) AS cnt
    FROM gemini_erros WHERE date(created_at) = date('now')
    GROUP BY tipo_erro
  `).all();

  const totalErrosHoje = errosHoje.reduce((s, r) => s + r.cnt, 0);

  // Último erro e último sucesso para determinar status da IA
  const ultimoErro = db.prepare(`
    SELECT modelo, tipo_erro, created_at FROM gemini_erros ORDER BY created_at DESC LIMIT 1
  `).get();

  const ultimoSucesso = db.prepare(`
    SELECT modelo, created_at FROM gemini_uso ORDER BY created_at DESC LIMIT 1
  `).get();

  // Modelo ativo: modelo do último sucesso registrado
  const modeloAtivo = ultimoSucesso?.modelo || 'gemini-1.5-flash';

  // Status da IA baseado nos últimos eventos
  let statusIA = 'ok';
  if (ultimoErro && !ultimoSucesso) {
    statusIA = 'error';
  } else if (ultimoErro && ultimoSucesso) {
    const tsErro    = new Date(ultimoErro.created_at).getTime();
    const tsSucesso = new Date(ultimoSucesso.created_at).getTime();
    const diffMin   = (Date.now() - tsErro) / 60000;
    if (tsErro > tsSucesso && diffMin < 5) statusIA = 'warning';
  }

  // Próximo reset: meia-noite UTC
  const agora   = new Date();
  const reset   = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1));
  const ms      = reset - agora;
  const horas   = Math.floor(ms / 3600000);
  const minutos = Math.floor((ms % 3600000) / 60000);

  // Limites tier gratuito gemini-1.5-flash
  const LIMITE_RPD = 1500;
  const LIMITE_RPM = 15;

  const pctDia    = Math.min(100, Math.round(usoDia.reqs / LIMITE_RPD * 100));
  const pctMinuto = Math.min(100, Math.round(usoMinuto.reqs / LIMITE_RPM * 100));

  res.json({
    ok: true,
    status_ia:    statusIA,
    modelo_ativo: modeloAtivo,
    dia: {
      requisicoes:        usoDia.reqs,
      tokens:             usoDia.tokens,
      limite_requisicoes: LIMITE_RPD,
      pct:                pctDia
    },
    minuto: {
      requisicoes:        usoMinuto.reqs,
      tokens:             usoMinuto.tokens,
      limite_requisicoes: LIMITE_RPM,
      pct:                pctMinuto
    },
    erros: {
      hoje:       totalErrosHoje,
      por_tipo:   Object.fromEntries(errosHoje.map(e => [e.tipo_erro, e.cnt])),
      ultimo:     ultimoErro ? { modelo: ultimoErro.modelo, tipo: ultimoErro.tipo_erro, em: ultimoErro.created_at } : null
    },
    ultimo_sucesso:    ultimoSucesso ? { modelo: ultimoSucesso.modelo, em: ultimoSucesso.created_at } : null,
    reset_em:          `${horas}h ${minutos}min`,
    reset_horario_utc: reset.toISOString(),
    atualizado_em:     new Date().toISOString(),
    historico
  });
});

module.exports = router;
