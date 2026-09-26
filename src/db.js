// src/db.js — Singleton de conexão com o banco SQLite
require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const dbPath = process.env.DB_PATH || './database/financeflow.db';

let _db;

function getDb() {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  _db = new Database(path.resolve(dbPath));

  // WAL aumenta a performance em leituras concorrentes
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Tabelas base (as colunas adicionadas depois ficam nas migrações abaixo)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario     TEXT    NOT NULL UNIQUE,
      nome        TEXT    NOT NULL,
      senha_hash  TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS bancos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nome        TEXT    NOT NULL,
      agencia     TEXT,
      conta       TEXT,
      saldo       REAL    DEFAULT 0,
      cor         TEXT    DEFAULT '#8a9ab5',
      ultima_sync TEXT,
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS transacoes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao   TEXT    NOT NULL,
      tipo        TEXT    NOT NULL CHECK(tipo IN ('entrada','saida')),
      categoria   TEXT    NOT NULL DEFAULT 'Outros',
      valor       REAL    NOT NULL,
      data        TEXT    NOT NULL,
      origem      TEXT    DEFAULT 'manual',
      foto_path   TEXT,
      banco_id    INTEGER,
      parcela_id  INTEGER DEFAULT NULL,
      status      TEXT    DEFAULT 'pago',
      id_externo  TEXT,
      aviso_vencimento INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS parcelas (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao      TEXT    NOT NULL,
      valor_total    REAL    NOT NULL,
      num_parcelas   INTEGER NOT NULL,
      parcelas_pagas INTEGER DEFAULT 0,
      categoria      TEXT    DEFAULT 'Outros',
      data_inicio    TEXT    NOT NULL,
      created_at     TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS despesas_futuras (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao     TEXT    NOT NULL,
      valor         REAL    NOT NULL,
      data_prevista TEXT    NOT NULL,
      prioridade    TEXT    DEFAULT 'media' CHECK(prioridade IN ('alta','media','baixa')),
      concluida     INTEGER DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS metas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nome          TEXT    NOT NULL,
      valor_alvo    REAL    NOT NULL,
      valor_atual   REAL    DEFAULT 0,
      aporte_mensal REAL    DEFAULT 0,
      categoria     TEXT    DEFAULT 'Outro',
      data_limite   TEXT,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS alertas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria     TEXT    NOT NULL,
      limite_mensal REAL    NOT NULL,
      ativo         INTEGER DEFAULT 1,
      avisado_mes   TEXT,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS calendario_eventos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao   TEXT    NOT NULL,
      valor       REAL    NOT NULL,
      tipo        TEXT    NOT NULL,
      dia_mes     INTEGER NOT NULL,
      recorrente  INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );
  `);

  // Índices para as queries mais frequentes (criados apenas se não existirem)
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transacoes_data      ON transacoes(data);
    CREATE INDEX IF NOT EXISTS idx_transacoes_tipo      ON transacoes(tipo);
    CREATE INDEX IF NOT EXISTS idx_transacoes_mes       ON transacoes(strftime('%Y-%m', data));
    CREATE INDEX IF NOT EXISTS idx_transacoes_parcela   ON transacoes(parcela_id);
    CREATE INDEX IF NOT EXISTS idx_transacoes_status    ON transacoes(status);
  `);

  // Migração: adiciona coluna status se ainda não existir
  const cols = _db.pragma('table_info(transacoes)').map(c => c.name);
  if (!cols.includes('status')) {
    _db.exec("ALTER TABLE transacoes ADD COLUMN status TEXT DEFAULT 'pago'");
  }
  if (!cols.includes('id_externo')) {
    _db.exec('ALTER TABLE transacoes ADD COLUMN id_externo TEXT');
  }
  // Marca se já mandamos o push de "vence hoje" pra essa transação (evita repetir todo dia)
  if (!cols.includes('aviso_vencimento')) {
    _db.exec('ALTER TABLE transacoes ADD COLUMN aviso_vencimento INTEGER DEFAULT 0');
  }

  // Migração: dedup de importação precisa ser por banco, não global — senão um lançamento
  // do titular A pode coincidir (mesma data/descrição/valor) com um do titular B e um "engolir"
  // o outro como se fosse duplicata. COALESCE(banco_id,0) trata os sem banco como um grupo único.
  // (depois substituído pelo índice por usuário em migrarMultiUsuario)
  const indicesTransacoes = _db.pragma('index_list(transacoes)').map(i => i.name);
  if (!indicesTransacoes.includes('idx_transacoes_id_externo_banco') &&
      !indicesTransacoes.includes('idx_transacoes_id_externo_usuario')) {
    if (indicesTransacoes.includes('idx_transacoes_id_externo')) {
      _db.exec('DROP INDEX idx_transacoes_id_externo');
    }
    _db.exec(`
      CREATE UNIQUE INDEX idx_transacoes_id_externo_banco
      ON transacoes(COALESCE(banco_id, 0), id_externo) WHERE id_externo IS NOT NULL
    `);
  }

  // Migração: adiciona coluna titular (dono da conta) em bancos, se ainda não existir
  const colsBancos = _db.pragma('table_info(bancos)').map(c => c.name);
  if (!colsBancos.includes('titular')) {
    _db.exec("ALTER TABLE bancos ADD COLUMN titular TEXT DEFAULT 'Você'");
  }

  // ── Investimentos ──────────────────────────────────────────────────────────
  _db.exec(`
    CREATE TABLE IF NOT EXISTS investimentos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo              TEXT    NOT NULL,   -- 'acao' | 'fii' | 'cripto' | 'renda_fixa'
      ticker            TEXT,               -- ex: PETR4, BTC — null para renda_fixa
      nome              TEXT    NOT NULL,
      quantidade        REAL    DEFAULT 0,
      preco_medio       REAL    DEFAULT 0,
      valor_aplicado    REAL    DEFAULT 0,
      rentabilidade_info TEXT,              -- ex: "CDI 110%", "IPCA + 6%" (só renda_fixa)
      vencimento        TEXT,
      banco_id          INTEGER REFERENCES bancos(id) ON DELETE SET NULL,
      created_at        TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_investimentos_tipo ON investimentos(tipo);

    CREATE TABLE IF NOT EXISTS cotacoes_cache (
      simbolo       TEXT PRIMARY KEY,
      preco         REAL,
      variacao_pct  REAL,
      atualizado_em TEXT
    );
  `);

  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_despesas_data        ON despesas_futuras(data_prevista);

    CREATE TABLE IF NOT EXISTS gemini_uso (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      modelo      TEXT    NOT NULL,
      tokens      INTEGER DEFAULT 0,
      tipo        TEXT    DEFAULT 'chat',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gemini_uso_created ON gemini_uso(created_at);

    CREATE TABLE IF NOT EXISTS gemini_erros (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      modelo      TEXT    NOT NULL,
      tipo_erro   TEXT    DEFAULT 'error',
      mensagem    TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gemini_erros_created ON gemini_erros(created_at);
  `);

  // ── Alerta de limite de gasto mensal (notificação push) ──────────────────────
  _db.exec(`
    CREATE TABLE IF NOT EXISTS limite_gasto (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      valor       REAL    NOT NULL,
      avisado_mes TEXT
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint    TEXT    NOT NULL UNIQUE,
      p256dh      TEXT    NOT NULL,
      auth        TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );

    -- Rastreia o último acesso ao app pra avisar (push) quando ficar 3+ dias sem abrir
    CREATE TABLE IF NOT EXISTS atividade_app (
      id                   INTEGER PRIMARY KEY CHECK (id = 1),
      ultimo_acesso        TEXT    NOT NULL,
      avisado_inatividade  INTEGER DEFAULT 0
    );
  `);

  migrarMultiUsuario(_db);

  // Links de "esqueci a senha": guarda só o hash do token; expira e só vale uma vez
  _db.exec(`
    CREATE TABLE IF NOT EXISTS redefinicoes_senha (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      token_hash  TEXT    NOT NULL UNIQUE,
      expira_em   INTEGER NOT NULL,          -- epoch em ms
      usado_em    INTEGER,
      ip          TEXT,
      criado_em   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_redefinicoes_usuario ON redefinicoes_senha(usuario_id);
  `);

  return _db;
}

// Tabelas cujos registros pertencem a um usuário. Todas as rotas filtram por usuario_id.
const TABELAS_DO_USUARIO = [
  'transacoes', 'parcelas', 'metas', 'despesas_futuras', 'bancos',
  'alertas', 'calendario_eventos', 'investimentos', 'push_subscriptions'
];

// Migração: o app nasceu single-user. Aqui cada tabela ganha usuario_id e todos os dados
// que já existiam são atribuídos à conta original (o primeiro usuário cadastrado).
// Idempotente — só age no que ainda não foi migrado.
function migrarMultiUsuario(db) {
  const colsUsuarios = db.pragma('table_info(usuarios)').map(c => c.name);
  const novasColsUsuario = {
    email:               'TEXT',
    papel:               "TEXT DEFAULT 'usuario'",
    ultimo_acesso:       'TEXT',
    avisado_inatividade: 'INTEGER DEFAULT 0',
    limite_gasto:        'REAL',
    limite_avisado_mes:  'TEXT',
    tema:                "TEXT DEFAULT 'escuro'",
    cor:                 "TEXT DEFAULT 'latao'",
    // Boas-vindas: contas antigas já nascem com 1 (não veem o tour); o cadastro grava 0
    tour_visto:          'INTEGER DEFAULT 1',
    checklist_oculto:    'INTEGER DEFAULT 1'
  };
  for (const [col, tipo] of Object.entries(novasColsUsuario)) {
    if (!colsUsuarios.includes(col)) db.exec(`ALTER TABLE usuarios ADD COLUMN ${col} ${tipo}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email) WHERE email IS NOT NULL');

  const dono = db.prepare('SELECT id FROM usuarios ORDER BY id ASC LIMIT 1').get();

  db.transaction(() => {
    for (const tabela of TABELAS_DO_USUARIO) {
      const cols = db.pragma(`table_info(${tabela})`).map(c => c.name);
      if (!cols.includes('usuario_id')) {
        db.exec(`ALTER TABLE ${tabela} ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE`);
      }
      if (dono) db.prepare(`UPDATE ${tabela} SET usuario_id = ? WHERE usuario_id IS NULL`).run(dono.id);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${tabela}_usuario ON ${tabela}(usuario_id)`);
    }

    if (dono) {
      // A conta original vira administradora e herda o limite de gasto e a atividade globais antigos
      db.prepare("UPDATE usuarios SET papel = 'admin' WHERE id = ? AND (papel IS NULL OR papel = 'usuario')").run(dono.id);

      const limite = db.prepare('SELECT * FROM limite_gasto WHERE id = 1').get();
      if (limite) {
        db.prepare('UPDATE usuarios SET limite_gasto = ?, limite_avisado_mes = ? WHERE id = ?')
          .run(limite.valor, limite.avisado_mes, dono.id);
        db.prepare('DELETE FROM limite_gasto WHERE id = 1').run();
      }

      const atividade = db.prepare('SELECT * FROM atividade_app WHERE id = 1').get();
      if (atividade) {
        db.prepare('UPDATE usuarios SET ultimo_acesso = ?, avisado_inatividade = ? WHERE id = ?')
          .run(atividade.ultimo_acesso, atividade.avisado_inatividade, dono.id);
        db.prepare('DELETE FROM atividade_app WHERE id = 1').run();
      }
    }

    // Dedup de importação agora é por usuário também — dois usuários podem importar o mesmo extrato
    const indices = db.pragma('index_list(transacoes)').map(i => i.name);
    if (!indices.includes('idx_transacoes_id_externo_usuario')) {
      if (indices.includes('idx_transacoes_id_externo_banco')) db.exec('DROP INDEX idx_transacoes_id_externo_banco');
      db.exec(`
        CREATE UNIQUE INDEX idx_transacoes_id_externo_usuario
        ON transacoes(usuario_id, COALESCE(banco_id, 0), id_externo) WHERE id_externo IS NOT NULL
      `);
    }
  })();
}

module.exports = { getDb };
