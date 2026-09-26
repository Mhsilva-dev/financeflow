// src/utils/pdf.js — Infra compartilhada de geração de PDF (renderiza HTML via Chromium headless)
const puppeteer = require('puppeteer');

function fmtMoeda(v) {
  return 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Cada PDF abre um Chromium inteiro (~150 MB). Limita a 2 ao mesmo tempo e
// recusa quando já há muitos na fila, para ninguém derrubar o servidor pedindo PDFs.
const MAX_SIMULTANEOS = 2;
const MAX_FILA = 6;
let emUso = 0;
const fila = [];

function adquirir() {
  if (emUso < MAX_SIMULTANEOS) { emUso++; return Promise.resolve(); }
  if (fila.length >= MAX_FILA) {
    const err = new Error('Muitos PDFs sendo gerados agora. Tente de novo em alguns segundos.');
    err.status = 429;
    return Promise.reject(err);
  }
  return new Promise(resolve => fila.push(resolve));
}

function liberar() {
  const proximo = fila.shift();
  if (proximo) proximo(); else emUso--;
}

async function renderizarPDF(html) {
  await adquirir();
  try {
    return await _renderizar(html);
  } finally {
    liberar();
  }
}

async function _renderizar(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser'
  });

  try {
    const page = await browser.newPage();
    // O HTML é todo gerado por nós; bloqueia qualquer requisição externa por garantia
    await page.setRequestInterception(true);
    page.on('request', r => (r.url().startsWith('data:') || r.url() === 'about:blank') ? r.continue() : r.abort());
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    return Buffer.from(pdf); // puppeteer 22+ retorna Uint8Array puro — Express só manda binário certo com Buffer real
  } finally {
    await browser.close();
  }
}

module.exports = { renderizarPDF, fmtMoeda, escapeHTML };
