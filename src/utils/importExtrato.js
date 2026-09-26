// src/utils/importExtrato.js — Parsers de extrato bancário (OFX, CSV e Excel)
// Alternativa 100% gratuita ao Open Finance: o usuário exporta o extrato
// direto do app do banco (ou joga a própria planilha) e importa aqui.
const ExcelJS = require('exceljs');

function parseValorBR(str) {
  let s = String(str).trim().replace(/[R$\s]/g, '');
  const negativo = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[()-]/g, '');
  // Padrão brasileiro nunca usa "." como decimal — com vírgula, "." é milhar (1.234,56 → 1234.56);
  // sem vírgula, qualquer "." também é milhar (2.000 → 2000, não 2.0)
  s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\./g, '');
  const num = parseFloat(s) || 0;
  return negativo ? -Math.abs(num) : num;
}

function parseDataFlexivel(str) {
  const s = String(str).trim();
  // YYYY-MM-DD ou YYYYMMDD (OFX)
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YYYY
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function formatDateUTC(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Excel guarda datas sem formatação como número serial (dias desde 1900) — converte pro padrão Unix
function excelSerialParaData(serial) {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

// Normaliza o valor de uma célula do ExcelJS: extrai resultado de fórmula, texto de hyperlink/rich text etc.
function valorCelula(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
  }
  return v;
}

// Interpreta uma data vinda de planilha: pode ser Date real, número serial do Excel ou texto
function parseDataCelula(v) {
  if (v instanceof Date) return formatDateUTC(v);
  if (typeof v === 'number' && v > 20000 && v < 60000) return formatDateUTC(excelSerialParaData(v));
  return parseDataFlexivel(v);
}

// ── Conversão comum de linhas (array de campos) + cabeçalho → transações ────
function linhasParaTransacoes(cabecalho, linhas, prefixo) {
  const idxData      = encontrarColuna(cabecalho, ['data', 'date']);
  const idxDescricao = encontrarColuna(cabecalho, ['descricao', 'historico', 'titulo', 'title', 'description', 'memo', 'lancamento']);
  const idxValor      = encontrarColuna(cabecalho, ['valor', 'amount', 'value']);
  const idxCategoria  = encontrarColuna(cabecalho, ['categoria', 'category']);

  if (idxData === -1 || idxValor === -1) return [];

  const transacoes = [];
  for (const campos of linhas) {
    const dataRaw = campos[idxData];
    if (dataRaw === undefined || dataRaw === null || dataRaw === '') continue;

    const data = parseDataCelula(dataRaw);
    const valorRaw = campos[idxValor];
    if (!data || valorRaw === undefined || valorRaw === null || valorRaw === '') continue;

    const valor = parseValorBR(valorRaw);
    const descricaoRaw = idxDescricao !== -1 ? campos[idxDescricao] : null;
    const descricao = (descricaoRaw !== undefined && descricaoRaw !== null && String(descricaoRaw).trim())
      ? String(descricaoRaw).trim()
      : 'Transação importada';
    const categoriaRaw = idxCategoria !== -1 ? campos[idxCategoria] : null;
    const categoria = (categoriaRaw !== undefined && categoriaRaw !== null && String(categoriaRaw).trim())
      ? String(categoriaRaw).trim()
      : null;

    transacoes.push({
      data,
      valor: Math.abs(valor),
      tipo: valor >= 0 ? 'entrada' : 'saida',
      descricao,
      categoria,
      idExterno: `${prefixo}:${data}|${descricao}|${valor}`
    });
  }

  return transacoes;
}

// ── OFX ────────────────────────────────────────────────────────────────────
function parseOFX(texto) {
  const transacoes = [];
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

  for (const bloco of blocos) {
    const pega = (tag) => {
      const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'));
      return m ? m[1].trim() : null;
    };

    const dataRaw = pega('DTPOSTED');
    const valorRaw = pega('TRNAMT');
    const fitid = pega('FITID');
    const descricao = pega('MEMO') || pega('NAME') || 'Transação importada';

    const data = dataRaw ? parseDataFlexivel(dataRaw) : null;
    if (!data || valorRaw === null) continue;

    const valor = parseFloat(valorRaw);
    transacoes.push({
      data,
      valor: Math.abs(valor),
      tipo: valor >= 0 ? 'entrada' : 'saida',
      descricao,
      idExterno: `ofx:${fitid || `${data}|${descricao}|${valor}`}`
    });
  }

  return transacoes;
}

// ── CSV ────────────────────────────────────────────────────────────────────
function splitCSVLine(linha, delimitador) {
  const campos = [];
  let atual = '';
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { dentroAspas = !dentroAspas; continue; }
    if (c === delimitador && !dentroAspas) { campos.push(atual); atual = ''; continue; }
    atual += c;
  }
  campos.push(atual);
  return campos.map(c => c.trim());
}

function normalizar(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

function encontrarColuna(cabecalho, candidatos) {
  const idx = cabecalho.findIndex(h => candidatos.some(c => normalizar(h) === c));
  return idx;
}

function parseCSV(texto, mesReferencia) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) return [];

  const delimitador = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const todasLinhas = linhas.map(l => splitCSVLine(l, delimitador));

  if (detectaOrcamentoTemplate(todasLinhas)) return parseOrcamentoTemplate(todasLinhas, mesReferencia);

  const cabecalho = todasLinhas[0].map(h => h.toLowerCase());
  const corpo = todasLinhas.slice(1);
  return linhasParaTransacoes(cabecalho, corpo, 'csv');
}

// ── Planilha de orçamento mensal (template comum tipo "Orçamento pessoal") ───
// Formato bem diferente de um extrato: não tem uma linha de cabeçalho única com "data"/"valor" —
// em vez disso tem várias mini-tabelas lado a lado, cada categoria (ex: DESPESAS, TRANSPORTE,
// COMIDA) com um bloco de colunas "Custo previsto" / "Custo Real" / "Diferença". Sem data por
// lançamento, então o mês inteiro é atribuído ao dia 1º do mês de referência informado pelo usuário.
function detectaOrcamentoTemplate(linhas) {
  return linhas.some(linha =>
    linha.some((celula, c) => normalizar(celula) === 'custoprevisto' && normalizar(linha[c + 1] || '') === 'custoreal')
  );
}

// Mapeia o nome livre da categoria/grupo da planilha pra uma das categorias fixas do sistema.
// Primeiro tenta pela palavra-chave do item em si (mais específico), depois cai pro grupo.
function mapearCategoria(grupo, item) {
  const regras = [
    [/agua|energia|aluguel|condominio|internet|telefone|moradia/, 'Moradia'],
    [/faculdade|escola|curso|ingles|educacao/, 'Educação'],
    [/academia|saude|medic|farmacia|dentista/, 'Saúde'],
    [/mercado|feira|alimenta|comida|restaurante|lanche/, 'Alimentação'],
    [/uber|combustive|transporte|onibus|passagem/, 'Transporte'],
    [/investimento|poupanc|aposentadoria/, 'Investimentos'],
    [/salario|renda/, 'Salário']
  ];
  const alvo = normalizar(`${item} ${grupo}`);
  for (const [regex, categoria] of regras) {
    if (regex.test(alvo)) return categoria;
  }
  const porGrupo = {
    entretenimento: 'Lazer',
    transporte: 'Transporte',
    comida: 'Alimentação',
    cuidadospessoais: 'Saúde',
    poupancasouinvestimentos: 'Investimentos'
  };
  return porGrupo[normalizar(grupo)] || 'Outros';
}

function parseOrcamentoTemplate(linhas, mesReferencia) {
  if (!mesReferencia || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesReferencia)) {
    throw new Error('MES_REFERENCIA_REQUERIDO');
  }
  const data = `${mesReferencia}-01`;

  // Acha todo cabeçalho de bloco ("Custo previsto" seguido de "Custo Real") e sua coluna/grupo
  const headers = [];
  linhas.forEach((linha, r) => {
    for (let c = 1; c < linha.length - 1; c++) {
      if (normalizar(linha[c]) === 'custoprevisto' && normalizar(linha[c + 1] || '') === 'custoreal') {
        headers.push({ row: r, col: c, grupo: (linha[c - 1] || '').trim() || 'Outros' });
      }
    }
  });

  // Agrupa por coluna — cada coluna pode ter vários blocos empilhados (um grupo termina, outro começa)
  const porColuna = {};
  for (const h of headers) (porColuna[h.col] = porColuna[h.col] || []).push(h);

  const itens = [];
  for (const col of Object.keys(porColuna).map(Number)) {
    const blocos = porColuna[col].sort((a, b) => a.row - b.row);
    blocos.forEach((h, idx) => {
      const fim = idx + 1 < blocos.length ? blocos[idx + 1].row : linhas.length;
      for (let r = h.row + 1; r < fim; r++) {
        const linha = linhas[r] || [];
        const label = (linha[col - 1] || '').trim();
        if (!label || normalizar(label) === 'total') continue;

        const previsto = parseValorBR(linha[col] || 0);
        const real     = parseValorBR(linha[col + 1] || 0);
        if (previsto <= 0 && real <= 0) continue;

        itens.push({ grupo: h.grupo, categoria: label, valor: real > 0 ? real : previsto });
      }
    });
  }

  return itens.map(it => ({
    data,
    valor: Math.abs(it.valor),
    tipo: 'saida',
    descricao: it.categoria,
    categoria: mapearCategoria(it.grupo, it.categoria),
    idExterno: `orcamento:${mesReferencia}|${it.grupo}|${it.categoria}|${it.valor}`
  }));
}

// ── Excel (.xlsx) — planilha própria do usuário, colunas em qualquer ordem ──
async function parseXLSX(buffer, mesReferencia) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Usa a primeira aba com conteúdo (ignora abas em branco antes da real)
  const sheet = workbook.worksheets.find(ws => ws.rowCount > 1) || workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return [];

  const todasLinhas = [];
  for (let i = 1; i <= sheet.rowCount; i++) {
    const valores = (sheet.getRow(i).values || []).slice(1).map(v => String(valorCelula(v) ?? '').trim());
    if (valores.every(v => v === '')) continue; // pula linha em branco
    todasLinhas.push(valores);
  }
  if (!todasLinhas.length) return [];

  if (detectaOrcamentoTemplate(todasLinhas)) return parseOrcamentoTemplate(todasLinhas, mesReferencia);

  const cabecalho = todasLinhas[0].map(h => h.toLowerCase());
  const corpo = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const valores = (sheet.getRow(i).values || []).slice(1).map(valorCelula);
    if (valores.every(v => v === null || v === undefined || v === '')) continue;
    corpo.push(valores);
  }

  return linhasParaTransacoes(cabecalho, corpo, 'xlsx');
}

// texto: conteúdo do arquivo (OFX/CSV) já decodificado como string
// buffer: buffer bruto do arquivo, necessário só para .xlsx (formato binário)
// mesReferencia: "YYYY-MM" — só usado quando o arquivo é uma planilha de orçamento sem data por lançamento
async function parseExtrato(texto, nomeArquivo, buffer, mesReferencia) {
  if (/\.xlsx$/i.test(nomeArquivo || '')) return parseXLSX(buffer, mesReferencia);

  const ehOFX = /<OFX>/i.test(texto) || /^OFXHEADER/i.test(texto.trim()) || /\.ofx$/i.test(nomeArquivo || '');
  return ehOFX ? parseOFX(texto) : parseCSV(texto, mesReferencia);
}

module.exports = { parseExtrato, parseOFX, parseCSV, parseXLSX };
