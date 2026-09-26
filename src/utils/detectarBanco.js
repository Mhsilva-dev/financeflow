// src/utils/detectarBanco.js — Identifica o banco de um extrato automaticamente
// Best-effort: usa código FEBRABAN (OFX) ou o nome do banco aparecendo no texto/nome do arquivo.
// Se não identificar, o import segue sem banco vinculado — nunca bloqueia a importação.

const BANCOS_FEBRABAN = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '104': 'Caixa Econômica Federal',
  '237': 'Bradesco',
  '341': 'Itaú',
  '260': 'Nubank',
  '077': 'Banco Inter',
  '212': 'Banco Original',
  '336': 'C6 Bank',
  '422': 'Banco Safra',
  '041': 'Banrisul',
  '070': 'BRB',
  '756': 'Sicoob',
  '748': 'Sicredi',
  '323': 'Mercado Pago',
  '380': 'PicPay',
  '208': 'BTG Pactual',
  '623': 'Banco Pan',
  '637': 'Banco Sofisa',
  '735': 'Neon'
};

// Nomes procurados no texto/nome do arquivo, em ordem (mais específico primeiro)
const NOMES_CONHECIDOS = [
  'Nubank', 'Itaú', 'Itau', 'Bradesco', 'Santander', 'Caixa Econômica', 'Caixa',
  'Banco do Brasil', 'Banco Inter', 'Inter', 'C6 Bank', 'C6', 'Banco Original', 'Original',
  'BTG Pactual', 'BTG', 'Sicoob', 'Sicredi', 'Mercado Pago', 'PicPay', 'Banrisul',
  'Banco Safra', 'Safra', 'Neon', 'Next', 'Banco Pan', 'Sofisa', 'Will Bank', 'Banco XP', 'XP Investimentos'
];

// Normaliza acentos/caixa e troca qualquer separador (_, -, ., espaço) por espaço único,
// pra "extrato_bradesco.csv" e "Extrato Bradesco.csv" darem match do mesmo jeito
function normalizar(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function detectarBancoPorTexto(texto) {
  const normalizado = ` ${normalizar(texto)} `;
  for (const nome of NOMES_CONHECIDOS) {
    const nomeNorm = ` ${normalizar(nome)} `;
    if (normalizado.includes(nomeNorm)) return nome === 'Itau' ? 'Itaú' : nome;
  }
  return null;
}

// OFX costuma trazer <ORG> (nome da instituição) e/ou <BANKID> (código FEBRABAN)
function detectarBancoOFX(texto) {
  const mOrg = texto.match(/<ORG>([^<\r\n]+)/i);
  if (mOrg) {
    const porNome = detectarBancoPorTexto(mOrg[1]);
    if (porNome) return porNome;
  }
  const mBankId = texto.match(/<BANKID>([^<\r\n]+)/i);
  if (mBankId) {
    const codigo = mBankId[1].trim().padStart(3, '0');
    if (BANCOS_FEBRABAN[codigo]) return BANCOS_FEBRABAN[codigo];
  }
  return detectarBancoPorTexto(texto);
}

module.exports = { detectarBancoPorTexto, detectarBancoOFX, BANCOS_FEBRABAN };
