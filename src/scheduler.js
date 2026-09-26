// src/scheduler.js — Tarefas agendadas em background
const cron = require('node-cron');
const { getDb } = require('./db');
const { hojeLocal, mesLocal } = require('./utils/datas');
const { enviarPush } = require('./push');
const { FUSO } = require('./utils/datas');

function fmtMoeda(v) {
  return 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Cada verificação percorre todos os usuários — cada um recebe push só sobre os próprios dados.

// Verifica se o gasto do mês estourou o limite configurado e avisa por push.
// Só dispara UMA vez por mês — mesmo que o gasto continue subindo, não fica repetindo o aviso.
async function verificarLimiteGasto(db) {
  const mesAtual = mesLocal();
  const usuarios = db.prepare(`
    SELECT id, limite_gasto FROM usuarios
    WHERE limite_gasto IS NOT NULL AND (limite_avisado_mes IS NULL OR limite_avisado_mes != ?)
  `).all(mesAtual);

  const somaMes = db.prepare(`
    SELECT COALESCE(SUM(valor), 0) AS total
    FROM transacoes WHERE usuario_id = ? AND tipo='saida' AND strftime('%Y-%m', data) = ?
  `);

  for (const u of usuarios) {
    const { total } = somaMes.get(u.id, mesAtual);
    if (total > u.limite_gasto) {
      await enviarPush(
        u.id,
        '⚠️ Limite de gasto estourado',
        `Você já gastou ${fmtMoeda(total)} este mês — limite era ${fmtMoeda(u.limite_gasto)}.`
      );
      db.prepare('UPDATE usuarios SET limite_avisado_mes = ? WHERE id = ?').run(mesAtual, u.id);
    }
  }
}

const DIAS_INATIVIDADE = 3;

// Avisa por push quando o usuário fica 3+ dias sem abrir o app. Dispara UMA vez por
// ausência — só volta a avisar depois que ele acessar de novo e ficar
// inativo por mais 3 dias (registrarAcesso, em auth.js, zera avisado_inatividade).
async function verificarInatividade(db) {
  const usuarios = db.prepare(`
    SELECT id, ultimo_acesso FROM usuarios
    WHERE ultimo_acesso IS NOT NULL AND (avisado_inatividade IS NULL OR avisado_inatividade = 0)
  `).all();

  for (const u of usuarios) {
    const diasSemAcesso = (Date.now() - new Date(u.ultimo_acesso).getTime()) / 86400000;
    if (diasSemAcesso < DIAS_INATIVIDADE) continue;

    await enviarPush(
      u.id,
      '👋 Sentimos sua falta!',
      `Já faz ${Math.floor(diasSemAcesso)} dias que você não dá uma olhada nas suas finanças. Que tal conferir agora?`
    );
    db.prepare('UPDATE usuarios SET avisado_inatividade = 1 WHERE id = ?').run(u.id);
  }
}

// Avisa por push quando tiver transação pendente/a pagar vencendo hoje.
// Marca aviso_vencimento pra não repetir o aviso no dia seguinte pela mesma transação.
async function verificarVencimentosHoje(db) {
  const hoje = hojeLocal();

  const rows = db.prepare(`
    SELECT id, usuario_id, descricao, valor FROM transacoes
    WHERE status IN ('pendente', 'a_pagar') AND data = ? AND (aviso_vencimento IS NULL OR aviso_vencimento = 0)
  `).all(hoje);

  if (!rows.length) return;

  const porUsuario = new Map();
  rows.forEach(r => {
    if (!porUsuario.has(r.usuario_id)) porUsuario.set(r.usuario_id, []);
    porUsuario.get(r.usuario_id).push(r);
  });

  const marcar = db.prepare('UPDATE transacoes SET aviso_vencimento = 1 WHERE id = ?');

  for (const [uid, lista] of porUsuario) {
    const corpo = lista.length === 1
      ? `${lista[0].descricao} — ${fmtMoeda(lista[0].valor)}`
      : `${lista.length} pagamentos: ${lista.map(r => r.descricao).join(', ')} — total ${fmtMoeda(lista.reduce((s, r) => s + r.valor, 0))}`;

    await enviarPush(uid, '💰 Pagamento vence hoje', corpo);
    db.transaction(() => lista.forEach(r => marcar.run(r.id)))();
  }
}

function iniciarAgendador() {
  // A cada hora, cheia — verifica se o limite de gasto do mês estourou
  cron.schedule('0 * * * *', async () => {
    try {
      await verificarLimiteGasto(getDb());
    } catch (err) {
      console.error('[Scheduler] Erro ao verificar limite de gasto:', err.message);
    }
  }, { timezone: FUSO });

  // Todo dia às 10h — verifica quem está sumido há 3+ dias
  cron.schedule('0 10 * * *', async () => {
    try {
      await verificarInatividade(getDb());
    } catch (err) {
      console.error('[Scheduler] Erro ao verificar inatividade:', err.message);
    }
  }, { timezone: FUSO });

  // Todo dia às 8h — avisa se algum pagamento pendente/a pagar vence hoje
  cron.schedule('0 8 * * *', async () => {
    try {
      await verificarVencimentosHoje(getDb());
    } catch (err) {
      console.error('[Scheduler] Erro ao verificar vencimentos:', err.message);
    }
  }, { timezone: FUSO });

  console.log('[Scheduler] Agendador iniciado — limite de gasto a cada hora, vencimentos às 8h, inatividade às 10h');
}

module.exports = { iniciarAgendador, verificarLimiteGasto, verificarInatividade, verificarVencimentosHoje };
