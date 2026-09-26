// src/server.js — Ponto de entrada principal do FinanceFlow Pro
require('dotenv').config();
const express   = require('express');
require('express-async-errors'); // erros em rotas async vão para o tratador de erros (antes podiam derrubar o processo)
const session   = require('express-session');
const FileStore = require('session-file-store')(session);
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const http      = require('http');
const WebSocket = require('ws');

// ── Validação de variáveis de ambiente obrigatórias ──────────────────────────
// Sem SESSION_SECRET, produção não sobe; em desenvolvimento usa um segredo aleatório (sessões caem a cada reinício)
if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[Config] SESSION_SECRET não definido — obrigatório em produção');
    process.exit(1);
  }
  process.env.SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
  console.warn('[Config] SESSION_SECRET não definido — usando um segredo temporário de desenvolvimento');
}
if (!process.env.GEMINI_API_KEY) {
  console.warn('[Config] GEMINI_API_KEY não definida — assistente IA ficará indisponível');
}

// ── Configuração CORS — whitelist de origens permitidas ──────────────────────
// Sem ALLOWED_ORIGINS, aceita só o próprio site (APP_URL); em dev sem APP_URL, qualquer origem
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : (process.env.APP_URL ? [new URL(process.env.APP_URL).origin] : null);

const corsOptions = {
  credentials: true,
  origin: ALLOWED_ORIGINS
    ? (origin, cb) => {
        // Permite requests sem origin (mobile apps, Postman) e origens na whitelist
        // Origem desconhecida: responde sem cabeçalhos CORS (o navegador bloqueia a leitura)
        cb(null, !origin || ALLOWED_ORIGINS.includes(origin));
      }
    : true
};

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

app.set('trust proxy', 1); // necessário para cookie seguro atrás do nginx
app.disable('x-powered-by');

// ── Middlewares globais ──────────────────────────────────────────────────────
app.use(cors(corsOptions));
// Uploads (foto/extrato) vão por multipart (multer); JSON nunca precisa ser grande
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const sessionParser = session({
  store: new FileStore({
    path: './sessions',
    ttl: 7 * 24 * 3600,
    retries: 1,
    logFn: () => {}       // silencia logs internos do FileStore
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 dias
  }
});
app.use(sessionParser);

// Uploads e arquivos estáticos
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// HTML e service worker sem cache — sempre servem a versão mais recente
// Páginas: "/" mostra a apresentação para quem não está logado e o app para quem
// está; "/entrar" sempre abre o app (que mostra a tela de login/cadastro).
const PUBLIC_DIR = path.join(__dirname, '../public');
const semCache = res => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
app.get('/', (req, res) => {
  semCache(res);
  res.sendFile(path.join(PUBLIC_DIR, req.session?.userId ? 'index.html' : 'landing.html'));
});
app.get(['/entrar', '/app', '/redefinir'], (req, res) => {
  semCache(res);
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// ── WebSocket — eventos em tempo real, entregues só às abas do mesmo usuário ─
// A conexão lê a sessão do cookie; sem login, é recusada.
const wsClients = new Set();

wss.on('connection', (ws, req) => {
  // Só aceita conexões vindas do próprio site (evita outro site abrir o WebSocket)
  const origem = req.headers.origin;
  if (origem && ALLOWED_ORIGINS && !ALLOWED_ORIGINS.includes(origem)) return ws.close(1008, 'Origem não autorizada');
  sessionParser(req, {}, () => {
    const uid = req.session?.userId;
    if (!uid) return ws.close(1008, 'Não autenticado');
    ws.uid = uid;
    wsClients.add(ws);
  });
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

// Quantas abas/dispositivos cada usuário tem conectados agora (painel admin)
global.conexoesPorUsuario = () => {
  const cont = new Map();
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) cont.set(ws.uid, (cont.get(ws.uid) || 0) + 1);
  });
  return cont;
};

// Envia evento para as conexões abertas do usuário dono do dado
global.broadcastWS = (data, uid) => {
  try {
    const msg = JSON.stringify(data);
    wsClients.forEach(ws => {
      if (ws.uid === uid && ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  } catch (err) {
    console.error('[WS] Erro ao serializar broadcast:', err.message);
  }
};

// ── Rotas da API ─────────────────────────────────────────────────────────────
const { exigirLogin } = require('./middleware/auth');

// Rotas públicas: conta (login/cadastro) e a chave pública VAPID. Todo o resto exige sessão e é filtrado por usuário.
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/push',        require('./routes/push'));

app.use('/api', exigirLogin);
app.use('/api/transacoes',  require('./routes/transacoes'));
app.use('/api/parcelas',    require('./routes/parcelas'));
app.use('/api/futuras',     require('./routes/futuras'));
app.use('/api/bancos',      require('./routes/bancos'));
app.use('/api/investimentos', require('./routes/investimentos'));
app.use('/api/calendario',  require('./routes/calendario'));
app.use('/api/ia',          require('./routes/ia'));
app.use('/api/relatorio',   require('./routes/relatorio'));
app.use('/api/inteligencia',require('./routes/inteligencia'));
app.use('/api/limite-gasto', require('./routes/limiteGasto'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ ok: false, erro: 'Rota não encontrada' }));

// SPA fallback — todas as rotas não-API servem o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Tratador de erros: URL malformada vira 400; o resto vira 500 com log curto (sem expor detalhes)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof URIError || err.status === 400 || err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, erro: 'Requisição inválida' });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ ok: false, erro: 'Conteúdo grande demais' });
  console.error(`[Erro] ${req.method} ${req.originalUrl.split('?')[0]}:`, err.stack || err.message);
  res.status(500).json({ ok: false, erro: 'Algo deu errado. Tente novamente.' });
});


// Rede de segurança: registra falhas fora das rotas em vez de derrubar o servidor
process.on('unhandledRejection', (err) => console.error('[Processo] Promise rejeitada sem tratamento:', err?.stack || err));

// ── Inicialização ────────────────────────────────────────────────────────────
// Abre o banco já no boot para as migrações rodarem antes da primeira requisição
require('./db').getDb();

const { iniciarAgendador } = require('./scheduler');
iniciarAgendador();

const PORT = process.env.PORT || 3001;
// Só aceita conexões da própria máquina (o nginx faz a ponte com HTTPS).
// Antes escutava em todas as interfaces: dava para abrir http://IP:3001 sem HTTPS.
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`\n🚀 FinanceFlow Pro rodando na porta ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Banco: ${process.env.DB_PATH || './database/financeflow.db'}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
