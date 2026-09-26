// src/gemini.js — Integração com Google Gemini AI
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getDb } = require('./db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Ordem de preferência — cada modelo tem cota própria no plano gratuito; se um falhar (cota, fora do ar), tenta o próximo.
// Os "-latest" são apelidos do Google que acompanham a versão atual (o gemini-2.0-flash foi desativado).
const MODELOS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'];

// Rate limiter de janela deslizante: máx 12 req/min (margem abaixo do limite de 15)
const _requestTimes = [];
function _checkRateLimit() {
  const now    = Date.now();
  const janela = now - 60000;
  while (_requestTimes.length && _requestTimes[0] < janela) _requestTimes.shift();
  if (_requestTimes.length >= 12) return _requestTimes[0] + 60000 - now + 200;
  _requestTimes.push(now);
  return 0;
}

// Extrai delay de retry sugerido pela API, ex: "Please retry in 14.26s"
function _parseRetryMs(msg) {
  const m = (msg || '').match(/retry in ([\d.]+)s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
}

// Salva sucesso de uso no banco
function _salvarUso(modelo, tokens, tipo) {
  try {
    if (tokens > 0) {
      getDb().prepare('INSERT INTO gemini_uso (modelo, tokens, tipo) VALUES (?, ?, ?)')
        .run(modelo, tokens, tipo);
    }
  } catch (_) {}
}

// Salva erro no banco para monitoramento
function _salvarErro(modelo, msg) {
  try {
    const isPerMinute = msg.includes('PerMinute') || msg.includes('per_minute') || msg.includes('GenerateRequestsPerMinute');
    const tipo = msg.includes('429') || msg.includes('Too Many Requests')
      ? (isPerMinute ? 'rate_limit_minute' : 'quota_exceeded')
      : 'error';
    getDb().prepare('INSERT INTO gemini_erros (modelo, tipo_erro, mensagem) VALUES (?, ?, ?)')
      .run(modelo, tipo, msg.slice(0, 500));
  } catch (_) {}
}

// Gerador genérico com fallback automático entre modelos e retry em rate limit por minuto
async function gerarConteudo(partes, tentativas = MODELOS, tipo = 'chat') {
  // Aguarda se estiver próximo do limite por minuto
  const espera = _checkRateLimit();
  if (espera > 0) await new Promise(r => setTimeout(r, espera));

  let ultimoErro;

  for (let i = 0; i < tentativas.length; i++) {
    const modelo = tentativas[i];
    let tentativasModelo = 0;

    while (tentativasModelo < 2) {
      try {
        const model  = genAI.getGenerativeModel({ model: modelo });
        const result = await model.generateContent(partes);
        const texto  = result.response.text();

        _salvarUso(modelo, result.response.usageMetadata?.totalTokenCount || 0, tipo);
        return texto;

      } catch (err) {
        ultimoErro = err;
        const msg = err.message || '';
        _salvarErro(modelo, msg);

        const is429       = err.status === 429 || msg.includes('[429') || msg.includes('Too Many Requests');
        const isPerMinute = msg.includes('PerMinute') || msg.includes('per_minute');
        const isQuotaZero = msg.includes('limit: 0');
        const isTransient = is429 || err.status === 503 || msg.includes('[503') || msg.includes('Service Unavailable');

        // Quota zero neste modelo → sem retry, tenta próximo
        if (isQuotaZero || !isTransient) break;

        // Rate limit por minuto na primeira tentativa → aguarda o delay sugerido e tenta de novo
        if (is429 && isPerMinute && tentativasModelo === 0) {
          const retryMs = _parseRetryMs(msg);
          if (retryMs > 0 && retryMs <= 65000) {
            console.warn(`[Gemini] Rate limit (${modelo}) — aguardando ${Math.ceil(retryMs/1000)}s...`);
            await new Promise(r => setTimeout(r, retryMs + 500));
            tentativasModelo++;
            continue;
          }
        }

        // Outros erros transitórios → tenta próximo modelo
        break;
      }
    }
  }

  throw ultimoErro;
}

// ── Leitura de Nota Fiscal / Comprovante ─────────────────────────────────────

async function analisarFotoGemini(base64Data, mimeType = 'image/jpeg') {
  try {
    const prompt = `Analise esta imagem de comprovante, nota fiscal, cupom fiscal ou recibo brasileiro.
Extraia as informações e responda APENAS em JSON válido, sem markdown, sem texto extra:

{
  "desc": "nome do estabelecimento ou produto principal (curto, max 40 chars)",
  "val": 0.00,
  "cat": "Alimentação|Moradia|Transporte|Saúde|Lazer|Educação|Roupas|Tecnologia|Serviços|Outros",
  "estab": "nome completo do estabelecimento",
  "data": "YYYY-MM-DD",
  "confianca": "alta|media|baixa"
}

Regras:
- val deve ser o valor TOTAL da compra (número decimal)
- Se não conseguir identificar valor, coloque 0
- Se não for um comprovante, retorne {"erro": "nao_e_comprovante"}
- data: use a data do comprovante, se não visível use hoje`;

    const result = await gerarConteudo([
      { inlineData: { data: base64Data, mimeType } },
      prompt
    ], MODELOS, 'foto');

    const text   = (typeof result === 'string' ? result : result.response.text()).replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);

    if (parsed.erro) return null;
    return parsed;

  } catch (err) {
    console.error('[Gemini] Erro ao analisar foto:', err.message);
    return null;
  }
}

// ── Leitura de Extrato Bancário em PDF ───────────────────────────────────────
// Layout de extrato varia demais de banco pra banco pra valer a pena regex —
// manda o PDF direto pra IA ler (Gemini lê PDF nativamente via inlineData).

async function analisarExtratoPDF(base64Data) {
  try {
    const prompt = `Analise este extrato bancário em PDF (pode ser de qualquer banco brasileiro).
Responda APENAS em JSON válido, sem markdown, sem texto extra:

{
  "banco": "nome do banco identificado no documento (ex: Nubank, Itaú, Bradesco) ou null se não conseguir identificar",
  "transacoes": [
    {"data": "YYYY-MM-DD", "descricao": "descrição curta do lançamento", "valor": 0.00, "tipo": "entrada"|"saida"}
  ]
}

Regras:
- valor sempre positivo (o sinal já é indicado pelo campo tipo)
- tipo "entrada" para créditos/depósitos/recebimentos, "saida" para débitos/pagamentos/compras
- Ignore linhas de saldo, cabeçalho, rodapé e resumo — só lançamentos individuais reais
- Se não conseguir ler nenhuma transação, retorne "transacoes": []`;

    const result = await gerarConteudo([
      { inlineData: { data: base64Data, mimeType: 'application/pdf' } },
      prompt
    ], MODELOS, 'extrato_pdf');

    const text = (typeof result === 'string' ? result : result.response.text()).replace(/```json|```/g, '').trim();
    return JSON.parse(text);

  } catch (err) {
    console.error('[Gemini] Erro ao analisar extrato PDF:', err.message);
    return null;
  }
}

// ── Assistente com ferramentas (function calling) ────────────────────────────
// A IA recebe as instruções, o histórico da conversa e a lista de consultas que
// pode fazer (ver src/services/assistente.js). Ela pede os dados de que precisa
// (ex: resumo_mes de 2026-09), o servidor executa e devolve, e ela responde.
// Mesmo fallback entre modelos do gerarConteudo: se um modelo falhar, tenta o próximo.
const MAX_RODADAS_FERRAMENTAS = 6;

async function conversarComFerramentas({ sistema, historico, mensagem, declaracoes, executar }) {
  let ultimoErro;

  for (const modelo of MODELOS) {
    try {
      const base = {
        model: modelo,
        systemInstruction: sistema,
        tools: [{ functionDeclarations: declaracoes }],
        generationConfig: { temperature: 0.3 }
      };
      // 1ª rodada: obrigada a consultar os dados (evita resposta "de memória" com números inventados)
      const modeloConsulta = genAI.getGenerativeModel({ ...base, toolConfig: { functionCallingConfig: { mode: 'ANY' } } });
      // Demais rodadas: livre para consultar mais ou responder
      const modeloLivre = genAI.getGenerativeModel({ ...base, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } });

      let chat = modeloConsulta.startChat({ history: historico });
      let entrada = mensagem;
      let tokens = 0;
      let pediuResposta = false;
      const consultas = [];

      for (let rodada = 0; rodada <= MAX_RODADAS_FERRAMENTAS; rodada++) {
        const espera = _checkRateLimit();
        if (espera > 0) await new Promise(r => setTimeout(r, espera));

        const result = await chat.sendMessage(entrada);
        tokens += result.response.usageMetadata?.totalTokenCount || 0;
        const chamadas = result.response.functionCalls() || [];

        if (rodada === 0) {
          // Troca para o modelo livre mantendo a conversa (incluindo a consulta pedida)
          chat = modeloLivre.startChat({ history: await chat.getHistory() });
        }

        if (!chamadas.length) {
          const texto = (result.response.text() || '').trim();
          if (texto) {
            _salvarUso(modelo, tokens, 'chat');
            return { texto, consultas };
          }
          // Veio vazio: pede explicitamente a resposta final uma vez
          if (pediuResposta) break;
          pediuResposta = true;
          entrada = 'Com base nos dados consultados, responda agora à pergunta do usuário.';
          continue;
        }
        if (rodada === MAX_RODADAS_FERRAMENTAS) break;

        // Executa todas as consultas pedidas nesta rodada e devolve os resultados
        entrada = await Promise.all(chamadas.map(async (c) => {
          consultas.push({ nome: c.name, args: c.args });
          return { functionResponse: { name: c.name, response: await executar(c.name, c.args) } };
        }));
      }
      throw new Error('Sem resposta final após as consultas');

    } catch (err) {
      ultimoErro = err;
      _salvarErro(modelo, err.message || '');
      console.warn(`[Gemini] Assistente falhou em ${modelo}:`, (err.message || '').slice(0, 160));
    }
  }
  throw ultimoErro;
}

// ── Dicas Personalizadas com base nos dados do usuário ───────────────────────

async function gerarDicasPersonalizadas(dados) {
  try {
    const prompt = `Analise estes dados financeiros e gere 5 dicas personalizadas de economia:

Dados:
- Receita mensal: R$ ${dados.entradas}
- Gastos por categoria: ${JSON.stringify(dados.categorias)}
- Taxa de poupança atual: ${dados.taxaPoupanca}%
- Parcelas ativas: ${dados.parcelas} totalizando R$ ${dados.totalParcelas}/mês

Responda em JSON com array de 5 objetos:
[{
  "titulo": "título curto e direto",
  "descricao": "explicação prática de 2 linhas",
  "economia_estimada": "ex: R$ 150/mês",
  "dificuldade": "fácil|médio|difícil"
}]

Seja específico com os valores reais do usuário.
Nunca cite nem recomende outros aplicativos, sites ou serviços de controle financeiro — as dicas devem ser ações que a pessoa faz no dia a dia ou dentro do próprio FinanceFlow (limite de gasto, contas futuras, parcelas, relatório).
Sem markdown, só JSON.`;

    const text = await gerarConteudo(prompt, MODELOS, 'dicas');
    return JSON.parse(text.replace(/```json|```/g, '').trim());

  } catch (err) {
    console.error('[Gemini] Erro dicas:', err.message);
    return [];
  }
}

// ── Recomendação de Investimentos ────────────────────────────────────────────
// Combina perfil financeiro real (saldo livre, gastos) + carteira atual + cotações
// ao vivo. Sempre educacional — o disclaimer de "não é recomendação registrada"
// é responsabilidade do frontend exibir junto da resposta.
async function gerarRecomendacaoInvestimento(perfil, carteira, cotacoes) {
  try {
    const prompt = `Você é um educador financeiro brasileiro. Analise os dados abaixo e responda APENAS em JSON válido, sem markdown:

Perfil financeiro do usuário:
- Saldo livre estimado (entradas - saídas do mês): R$ ${perfil.saldoLivre}
- Taxa de poupança: ${perfil.taxaPoupanca}%
- Gastos por categoria: ${JSON.stringify(perfil.categorias)}

Carteira atual de investimentos:
${carteira.length ? JSON.stringify(carteira) : '(carteira vazia)'}

Cotações atuais dos ativos que ele tem ou de referência (USD, EUR, BTC, IBOV):
${JSON.stringify(cotacoes)}

Responda no formato:
{
  "resumo": "1-2 frases sobre a situação geral e capacidade de investir agora",
  "sugestoes": [
    {"titulo": "título curto", "descricao": "sugestão prática de alocação/diversificação em até 2 linhas"}
  ],
  "comentarios_ativos": [
    {"ticker": "PETR4", "comentario": "comentário curto sobre esse ativo específico da carteira, baseado na cotação atual"}
  ]
}

Regras:
- Gere de 2 a 4 sugestões, priorizando diversificação e o que cabe no saldo livre informado
- Só inclua comentarios_ativos para ativos que aparecem na carteira atual (se vazia, retorne array vazio)
- Nunca prometa rentabilidade garantida nem dê ordem de compra/venda categórica — sempre em tom educacional
- Seja específico usando os valores reais informados
- Não recomende corretoras, bancos ou aplicativos específicos pelo nome, nem outros apps de controle financeiro — fale de tipos de investimento (Tesouro Direto, CDB, fundos imobiliários etc.)`;

    const text = await gerarConteudo(prompt, MODELOS, 'investimentos');
    return JSON.parse(text.replace(/```json|```/g, '').trim());

  } catch (err) {
    console.error('[Gemini] Erro recomendação investimentos:', err.message);
    return null;
  }
}

module.exports = { analisarFotoGemini, analisarExtratoPDF, conversarComFerramentas, gerarDicasPersonalizadas, gerarRecomendacaoInvestimento };
