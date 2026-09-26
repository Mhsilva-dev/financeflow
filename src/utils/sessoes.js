// src/utils/sessoes.js — Encerra as sessões abertas de um usuário (outros aparelhos)
// Usado ao trocar/redefinir a senha e ao excluir a conta. As sessões ficam em
// arquivos JSON na pasta ./sessions (session-file-store).
const fs   = require('fs');
const path = require('path');

function encerrarSessoes(uid, excetoSessionId) {
  const dir = path.resolve('sessions');
  let arquivos = [];
  try { arquivos = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (_) { return; }
  for (const f of arquivos) {
    if (excetoSessionId && f === `${excetoSessionId}.json`) continue;
    try {
      const dados = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (dados.userId === uid) fs.unlinkSync(path.join(dir, f));
    } catch (_) {}
  }
}

module.exports = { encerrarSessoes };
