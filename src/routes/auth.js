// src/routes/auth.js — Contas de usuário (cadastro, login, logout, perfil)
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const { enviarEmail, emailRedefinicao } = require('../utils/email');
const { getDb } = require('../db');
const { hojeLocal } = require('../utils/datas');
const { gerarPlanilhaDados } = require('../utils/exportarDados');
const { encerrarSessoes } = require('../utils/sessoes');
const { ultimaAtividade } = require('../middleware/auth');

const REGEX_USUARIO = /^[a-z0-9._-]{3,30}$/;
const REGEX_EMAIL   = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SENHA_MIN     = 6;

// Cadastro aberto por padrão — REGISTRO_ABERTO=false no .env fecha novas contas
const registroAberto = () => process.env.REGISTRO_ABERTO !== 'false';

// ── Limite de tentativas por IP (protege login/cadastro contra força bruta) ──
const tentativas = new Map();
function limitarTentativas(max, janelaMin) {
  return (req, res, next) => {
    const chave = `${req.path}|${req.ip}`;
    const agora = Date.now();
    const reg = tentativas.get(chave);
    if (!reg || agora > reg.expira) {
      tentativas.set(chave, { qtd: 1, expira: agora + janelaMin * 60000 });
      return next();
    }
    if (reg.qtd >= max) {
      const min = Math.ceil((reg.expira - agora) / 60000);
      return res.status(429).json({ ok: false, erro: `Muitas tentativas. Tente de novo em ${min} min.` });
    }
    reg.qtd++;
    next();
  };
}
setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of tentativas) if (agora > v.expira) tentativas.delete(k);
}, 10 * 60000).unref();

// Marca "acessei agora" e reseta o aviso de inatividade — chamado a cada login
// ou verificação de sessão válida (ou seja, toda vez que o app é aberto).
function registrarAcesso(db, uid) {
  ultimaAtividade.set(uid, Date.now());
  db.prepare(`UPDATE usuarios SET ultimo_acesso = datetime('now','localtime'), avisado_inatividade = 0 WHERE id = ?`).run(uid);
}

function iniciarSessao(req, user) {
  return new Promise((resolve, reject) => {
    // Nova sessão a cada login evita fixação de sessão
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.userId  = user.id;
      req.session.usuario = user.usuario;
      req.session.nome    = user.nome;
      resolve();
    });
  });
}

function perfil(user) {
  return {
    nome: user.nome, usuario: user.usuario, email: user.email || null, papel: user.papel || 'usuario',
    tema: user.tema || 'escuro', cor: user.cor || 'latao',
    tour_visto: user.tour_visto ?? 1, checklist_oculto: user.checklist_oculto ?? 1
  };
}

const TEMAS = new Set(['escuro', 'claro']);
const CORES = new Set(['latao', 'azul', 'lavanda', 'petroleo']);

// ── GET /config — O front pergunta se pode mostrar "Criar conta" ─────────────
router.get('/config', (req, res) => {
  res.json({ ok: true, registro_aberto: registroAberto() });
});

// ── POST /registro — Cria uma conta nova (dados começam zerados) ─────────────
router.post('/registro', limitarTentativas(5, 60), async (req, res) => {
  if (!registroAberto()) {
    return res.status(403).json({ ok: false, erro: 'Novos cadastros estão temporariamente fechados' });
  }

  const nome    = String(req.body.nome || '').trim().slice(0, 60);
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  const email   = String(req.body.email || '').trim().toLowerCase();
  const senha   = String(req.body.senha || '');

  if (nome.length < 2)               return res.status(400).json({ ok: false, erro: 'Informe seu nome' });
  if (!REGEX_USUARIO.test(usuario))  return res.status(400).json({ ok: false, erro: 'Usuário deve ter 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _' });
  if (!REGEX_EMAIL.test(email))      return res.status(400).json({ ok: false, erro: 'E-mail inválido' });
  if (senha.length < SENHA_MIN)      return res.status(400).json({ ok: false, erro: `A senha deve ter pelo menos ${SENHA_MIN} caracteres` });

  const db = getDb();
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(usuario)) {
    return res.status(409).json({ ok: false, erro: 'Esse usuário já está em uso' });
  }
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
    return res.status(409).json({ ok: false, erro: 'Já existe uma conta com esse e-mail' });
  }

  const hash = await bcrypt.hash(senha, 12);
  const result = db.prepare(`
    INSERT INTO usuarios (usuario, nome, email, senha_hash, papel, ultimo_acesso, tour_visto, checklist_oculto)
    VALUES (?, ?, ?, ?, 'usuario', datetime('now','localtime'), 0, 0)
  `).run(usuario, nome, email, hash);

  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(result.lastInsertRowid);
  await iniciarSessao(req, user);
  registrarAcesso(db, user.id);
  res.json({ ok: true, ...perfil(user), novo: true });
});

// ── POST /login — Aceita usuário ou e-mail ───────────────────────────────────
router.post('/login', limitarTentativas(10, 15), async (req, res) => {
  const { usuario, senha } = req.body;

  if (!usuario || !senha) {
    return res.status(400).json({ ok: false, erro: 'Usuário e senha obrigatórios' });
  }

  const db    = getDb();
  const login = String(usuario).trim().toLowerCase();
  const user  = db.prepare('SELECT * FROM usuarios WHERE usuario = ? OR email = ?').get(login, login);

  // Mensagem genérica para não vazar se o usuário existe ou não
  if (!user || !(await bcrypt.compare(String(senha), user.senha_hash))) {
    return res.status(401).json({ ok: false, erro: 'Usuário ou senha incorretos' });
  }

  await iniciarSessao(req, user);
  registrarAcesso(db, user.id);

  res.json({ ok: true, ...perfil(user) });
});

// ── POST /logout ──────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── GET /me — Retorna dados da sessão atual ───────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false });
  }
  const db   = getDb();
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.userId);
  if (!user) {
    // Conta removida enquanto a sessão existia
    return req.session.destroy(() => res.status(401).json({ ok: false }));
  }
  registrarAcesso(db, user.id);
  res.json({ ok: true, ...perfil(user) });
});

// ── PUT /trocar — Alterar nome, e-mail, usuário e/ou senha ───────────────────
router.put('/trocar', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado' });
  }

  const { senha_atual, nova_senha, novo_usuario, novo_nome, novo_email } = req.body;

  if (!senha_atual) {
    return res.status(400).json({ ok: false, erro: 'Senha atual obrigatória' });
  }

  const db   = getDb();
  const uid  = req.session.userId;
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(uid);

  if (!(await bcrypt.compare(String(senha_atual), user.senha_hash))) {
    return res.status(401).json({ ok: false, erro: 'Senha atual incorreta' });
  }

  // Valida tudo antes de gravar qualquer coisa
  const novoUser  = novo_usuario ? String(novo_usuario).trim().toLowerCase() : null;
  const novoEmail = novo_email   ? String(novo_email).trim().toLowerCase()   : null;
  const novoNome  = novo_nome    ? String(novo_nome).trim().slice(0, 60)     : null;

  if (nova_senha && String(nova_senha).length < SENHA_MIN) {
    return res.status(400).json({ ok: false, erro: `A nova senha deve ter pelo menos ${SENHA_MIN} caracteres` });
  }
  if (novoUser) {
    if (!REGEX_USUARIO.test(novoUser)) {
      return res.status(400).json({ ok: false, erro: 'Usuário deve ter 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou _' });
    }
    if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ? AND id != ?').get(novoUser, uid)) {
      return res.status(400).json({ ok: false, erro: 'Nome de usuário já está em uso' });
    }
  }
  if (novoEmail) {
    if (!REGEX_EMAIL.test(novoEmail)) return res.status(400).json({ ok: false, erro: 'E-mail inválido' });
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ? AND id != ?').get(novoEmail, uid)) {
      return res.status(400).json({ ok: false, erro: 'Já existe uma conta com esse e-mail' });
    }
  }
  if (novoNome !== null && novoNome.length < 2) {
    return res.status(400).json({ ok: false, erro: 'Informe seu nome' });
  }

  if (nova_senha) {
    const hash = await bcrypt.hash(String(nova_senha), 12);
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hash, uid);
    encerrarSessoes(uid, req.sessionID);   // outros aparelhos saem; este continua logado
  }
  if (novoUser)  { db.prepare('UPDATE usuarios SET usuario = ? WHERE id = ?').run(novoUser, uid); req.session.usuario = novoUser; }
  if (novoEmail) db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(novoEmail, uid);
  if (novoNome)  { db.prepare('UPDATE usuarios SET nome = ? WHERE id = ?').run(novoNome, uid); req.session.nome = novoNome; }

  const atualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(uid);
  res.json({ ok: true, ...perfil(atualizado) });
});

// ── PUT /aparencia — Tema (escuro/claro) e cor de destaque, salvos na conta ──
router.put('/aparencia', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, erro: 'Não autorizado' });
  const { tema, cor } = req.body;
  if (tema !== undefined && !TEMAS.has(tema)) return res.status(400).json({ ok: false, erro: 'Tema inválido' });
  if (cor !== undefined && !CORES.has(cor))   return res.status(400).json({ ok: false, erro: 'Cor inválida' });

  const db = getDb();
  if (tema) db.prepare('UPDATE usuarios SET tema = ? WHERE id = ?').run(tema, req.session.userId);
  if (cor)  db.prepare('UPDATE usuarios SET cor = ? WHERE id = ?').run(cor, req.session.userId);
  res.json({ ok: true });
});

// ── PUT /onboarding — Marca o tour como visto / oculta a lista de primeiros passos ──
router.put('/onboarding', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, erro: 'Não autorizado' });
  const db = getDb();
  if (req.body.tour_visto !== undefined) {
    db.prepare('UPDATE usuarios SET tour_visto = ? WHERE id = ?').run(req.body.tour_visto ? 1 : 0, req.session.userId);
  }
  if (req.body.checklist_oculto !== undefined) {
    db.prepare('UPDATE usuarios SET checklist_oculto = ? WHERE id = ?').run(req.body.checklist_oculto ? 1 : 0, req.session.userId);
  }
  res.json({ ok: true });
});

// ── GET /primeiros-passos — O que o usuário novo já fez (para a lista do painel) ──
router.get('/primeiros-passos', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, erro: 'Não autorizado' });
  const db  = getDb();
  const uid = req.session.userId;
  const conta = sql => db.prepare(sql).get(uid).n;
  res.json({
    ok: true,
    banco:     conta('SELECT COUNT(*) AS n FROM bancos WHERE usuario_id = ?') > 0,
    transacao: conta('SELECT COUNT(*) AS n FROM transacoes WHERE usuario_id = ?') > 0,
    limite:    conta('SELECT COUNT(*) AS n FROM usuarios WHERE id = ? AND limite_gasto IS NOT NULL') > 0
  });
});

// ── GET /exportar — Baixa todos os dados do usuário numa planilha Excel ─────
router.get('/exportar', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, erro: 'Não autorizado' });
  try {
    const buffer = await gerarPlanilhaDados(getDb(), req.session.userId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="financeflow-meus-dados-${hojeLocal()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('[Exportar] Erro:', err);
    res.status(500).json({ ok: false, erro: 'Não foi possível gerar a planilha. Tente novamente.' });
  }
});

// ── ESQUECI A SENHA ──────────────────────────────────────────────────────────
const VALIDADE_LINK_MIN = 60;
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function baseUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

// Busca um pedido de redefinição válido (não usado e não expirado) pelo token
function pedidoValido(db, token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`
    SELECT r.*, u.nome, u.email FROM redefinicoes_senha r JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.token_hash = ? AND r.usado_em IS NULL AND r.expira_em > ?
  `).get(hashToken(token), Date.now());
}

// ── POST /esqueci — Envia o link de redefinição para o e-mail ────────────────
// Sempre responde igual (exista ou não a conta) e sem esperar o envio,
// para ninguém descobrir pelo texto ou pelo tempo quais e-mails têm conta.
router.post('/esqueci', limitarTentativas(5, 60), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!REGEX_EMAIL.test(email)) return res.status(400).json({ ok: false, erro: 'Informe um e-mail válido' });

  res.json({ ok: true });

  const db = getDb();
  const user = db.prepare('SELECT id, nome, email FROM usuarios WHERE email = ?').get(email);
  if (!user) return;

  // Evita enxurrada de e-mails: no máximo um link a cada 2 minutos por conta
  const recente = db.prepare('SELECT 1 FROM redefinicoes_senha WHERE usuario_id = ? AND criado_em > ?')
    .get(user.id, Date.now() - 2 * 60000);
  if (recente) return;

  const token = crypto.randomBytes(32).toString('hex');
  db.transaction(() => {
    // Um link novo invalida os anteriores
    db.prepare('UPDATE redefinicoes_senha SET usado_em = ? WHERE usuario_id = ? AND usado_em IS NULL').run(Date.now(), user.id);
    db.prepare(`INSERT INTO redefinicoes_senha (usuario_id, token_hash, expira_em, ip, criado_em) VALUES (?, ?, ?, ?, ?)`)
      .run(user.id, hashToken(token), Date.now() + VALIDADE_LINK_MIN * 60000, req.ip, Date.now());
  })();

  const link = `${baseUrl(req)}/redefinir?token=${token}`;
  const msg = emailRedefinicao({ nome: user.nome, link, validadeMin: VALIDADE_LINK_MIN });
  enviarEmail({ para: user.email, ...msg })
    .catch(err => console.error('[Email] Falha ao enviar redefinição:', err.message));
});

// ── GET /redefinir/validar — O front confere o link antes de mostrar o formulário ──
router.get('/redefinir/validar', (req, res) => {
  const pedido = pedidoValido(getDb(), String(req.query.token || ''));
  res.json({ ok: true, valido: !!pedido });
});

// ── POST /redefinir — Grava a senha nova e já entra na conta ─────────────────
router.post('/redefinir', limitarTentativas(10, 15), async (req, res) => {
  const token = String(req.body.token || '');
  const senha = String(req.body.senha || '');
  if (senha.length < SENHA_MIN) {
    return res.status(400).json({ ok: false, erro: `A senha deve ter pelo menos ${SENHA_MIN} caracteres` });
  }

  const db = getDb();
  const pedido = pedidoValido(db, token);
  if (!pedido) {
    return res.status(400).json({ ok: false, erro: 'Este link expirou ou já foi usado. Peça um novo.', expirado: true });
  }

  const hash = await bcrypt.hash(senha, 12);
  db.transaction(() => {
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hash, pedido.usuario_id);
    db.prepare('UPDATE redefinicoes_senha SET usado_em = ? WHERE usuario_id = ? AND usado_em IS NULL').run(Date.now(), pedido.usuario_id);
  })();

  // Quem estava logado em outro aparelho com a senha antiga sai
  encerrarSessoes(pedido.usuario_id);

  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(pedido.usuario_id);
  await iniciarSessao(req, user);
  registrarAcesso(db, user.id);
  res.json({ ok: true, ...perfil(user) });
});

// ── DELETE /conta — Usuário apaga a própria conta e todos os dados dela ──────
// A conta administradora (a original) nunca pode ser apagada por aqui.
router.delete('/conta', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ ok: false, erro: 'Não autorizado' });

  const db   = getDb();
  const uid  = req.session.userId;
  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(uid);

  if (user.papel === 'admin') {
    return res.status(403).json({ ok: false, erro: 'A conta administradora não pode ser excluída' });
  }
  if (!req.body.senha || !(await bcrypt.compare(String(req.body.senha), user.senha_hash))) {
    return res.status(401).json({ ok: false, erro: 'Senha incorreta' });
  }

  // Apaga explicitamente (não depende só do ON DELETE CASCADE) — transações primeiro por causa das FKs
  db.transaction(() => {
    for (const t of ['transacoes', 'investimentos', 'parcelas', 'metas', 'despesas_futuras',
                     'alertas', 'calendario_eventos', 'push_subscriptions', 'bancos']) {
      db.prepare(`DELETE FROM ${t} WHERE usuario_id = ?`).run(uid);
    }
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(uid);
  })();
  encerrarSessoes(uid, req.sessionID);

  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
