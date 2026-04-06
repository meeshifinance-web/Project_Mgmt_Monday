require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const pool = require('./db');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'workboard_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 10 * 60 * 1000 }, // 10 min, only for OAuth state
}));

// ── Rate limiter for API key requests ────────────────────────────────────────
// Only active on requests that carry an X-API-Key header.
// JWT-authenticated browser traffic is skipped entirely.
const rateLimit = require('express-rate-limit');
const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: (req) => {
    if (!req.headers['x-api-key']) return 10000;
    // Scope-based limits; scope is not yet decoded here so we use a safe default.
    // Fine-grained enforcement is done post-auth inside requireScope.
    return 2000;
  },
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  message: { error: 'Rate limit exceeded. See X-RateLimit-Limit header.' },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) => !req.headers['x-api-key'],
});
app.use('/api/', apiKeyRateLimiter);

// ── Public auth routes (no JWT required) ──────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));

// ── Protected routes (JWT required — enforced in each route file) ─────────────
app.use('/api/boards', require('./routes/boards'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/items', require('./routes/items'));
app.use('/api/columns', require('./routes/columns'));
app.use('/api/column-values', require('./routes/columnValues'));
app.use('/api/automations', require('./routes/automations'));
app.use('/api/activity-logs', require('./routes/activityLogs'));
app.use('/api/trash', require('./routes/trash'));
app.use('/api/email', require('./routes/emailAdmin'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api', require('./routes/forms'));
app.use('/api/boards', require('./routes/exportImport'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/items',        require('./routes/itemEmails'));
app.use('/api/global-trash', require('./routes/globalTrash'));
app.use('/api/views',       require('./routes/views'));
app.use('/api/keys',        require('./routes/apiKeys'));
app.use('/api/files',       require('./routes/files'));
app.use('/api/search',     require('./routes/search'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── Global error handler ──────────────────────────────────────────────────────
// Must be defined after all routes. Catches any error passed via next(err)
// and prevents raw err.message / stack traces leaking to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err.stack || err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ DB connected');

    // Auto-create activity_logs table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id SERIAL PRIMARY KEY,
        board_id INT REFERENCES boards(id) ON DELETE CASCADE,
        user_id INT,
        user_name TEXT,
        item_id INT,
        item_name TEXT,
        action TEXT NOT NULL,
        field TEXT,
        old_value TEXT,
        new_value TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_act_board ON activity_logs(board_id)`);

    // Trash / recycle-bin table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trash_items (
        id                   SERIAL PRIMARY KEY,
        board_id             INT REFERENCES boards(id) ON DELETE CASCADE,
        group_id             INT,
        group_name           TEXT,
        item_id              INT,
        name                 TEXT NOT NULL,
        values               JSONB DEFAULT '{}',
        deleted_by_user_id   INT,
        deleted_by_user_name TEXT,
        deleted_at           TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_trash_board ON trash_items(board_id)`);

    // Comments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id         SERIAL PRIMARY KEY,
        item_id    INT REFERENCES items(id) ON DELETE CASCADE,
        board_id   INT REFERENCES boards(id) ON DELETE CASCADE,
        user_id    INT,
        user_name  TEXT,
        body       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_id)`);
    // Add parent_id (threading) if not already there
    await pool.query(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES comments(id) ON DELETE CASCADE`);

    // Notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id              SERIAL PRIMARY KEY,
        user_id         INT NOT NULL,
        from_user_id    INT,
        from_user_name  TEXT,
        item_id         INT,
        item_name       TEXT,
        board_id        INT,
        board_name      TEXT,
        comment_id      INT,
        message         TEXT NOT NULL,
        is_read         BOOLEAN DEFAULT false,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS board_name TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(user_id, is_read)`);

    // Board folders
    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_folders (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        position   INT DEFAULT 0,
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS folder_id INT REFERENCES board_folders(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS email_from TEXT`);
    await pool.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS item_name TEXT DEFAULT 'Item'`);

    // Soft-delete columns for boards and folders (trash with 15-day retention)
    await pool.query(`ALTER TABLE boards       ADD COLUMN IF NOT EXISTS is_deleted           BOOLEAN      DEFAULT false`);
    await pool.query(`ALTER TABLE boards       ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE boards       ADD COLUMN IF NOT EXISTS deleted_by_user_id   INT`);
    await pool.query(`ALTER TABLE boards       ADD COLUMN IF NOT EXISTS deleted_by_user_name TEXT`);
    await pool.query(`ALTER TABLE board_folders ADD COLUMN IF NOT EXISTS is_deleted           BOOLEAN      DEFAULT false`);
    await pool.query(`ALTER TABLE board_folders ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE board_folders ADD COLUMN IF NOT EXISTS deleted_by_user_id   INT`);
    await pool.query(`ALTER TABLE board_folders ADD COLUMN IF NOT EXISTS deleted_by_user_name TEXT`);
    await pool.query(`ALTER TABLE board_folders ADD COLUMN IF NOT EXISTS board_ids_snapshot   JSONB        DEFAULT '[]'`);

    // Purge boards & folders that have been in trash for > 15 days
    await pool.query(`DELETE FROM boards        WHERE is_deleted = true AND deleted_at < NOW() - INTERVAL '15 days'`);
    await pool.query(`DELETE FROM board_folders WHERE is_deleted = true AND deleted_at < NOW() - INTERVAL '15 days'`);
    console.log('✅ Global trash columns ready; stale entries purged');

    // Email thread log — incoming emails from poller, outgoing from automations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS item_emails (
        id           SERIAL PRIMARY KEY,
        item_id      INT REFERENCES items(id) ON DELETE CASCADE,
        board_id     INT REFERENCES boards(id) ON DELETE CASCADE,
        direction    TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
        from_address TEXT,
        from_name    TEXT,
        to_address   TEXT,
        subject      TEXT,
        body_text    TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_item_emails_item ON item_emails(item_id)`);

    // Purge items older than 15 days on every startup
    await pool.query(`DELETE FROM trash_items WHERE deleted_at < NOW() - INTERVAL '15 days'`);

    // Add creator columns to items if they don't exist yet
    await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS created_by_user_id   INT`);
    await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS created_by_user_name TEXT`);

    // Subitems — hierarchical items support
    await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS parent_item_id INT REFERENCES items(id) ON DELETE CASCADE`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_item_id)`);

    // Extend role CHECK constraint to include 'member'
    // Drop old constraint (if any) and recreate with all 4 roles
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','manager','member','user'))`);
    console.log('✅ Role constraint updated (admin / manager / member / user)');

    // Forms tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS forms (
        id               SERIAL PRIMARY KEY,
        board_id         INTEGER REFERENCES boards(id) ON DELETE CASCADE,
        target_group_id  INTEGER REFERENCES groups(id) ON DELETE SET NULL,
        title            TEXT NOT NULL DEFAULT 'Untitled Form',
        description      TEXT,
        cover_color      TEXT DEFAULT '#0073ea',
        thank_you_message TEXT DEFAULT 'Thank you! Your response has been submitted.',
        is_active        BOOLEAN DEFAULT true,
        slug             TEXT UNIQUE,
        created_at       TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_forms_board ON forms(board_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_forms_slug  ON forms(slug)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS form_fields (
        id          SERIAL PRIMARY KEY,
        form_id     INTEGER REFERENCES forms(id) ON DELETE CASCADE,
        column_id   INTEGER REFERENCES columns(id) ON DELETE CASCADE,
        label       TEXT,
        is_required BOOLEAN DEFAULT false,
        position    INTEGER DEFAULT 0,
        is_visible  BOOLEAN DEFAULT true
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields(form_id)`);
    await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS item_name_label TEXT DEFAULT 'Item Name'`);

    // API Keys table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          VARCHAR(100) NOT NULL,
        key_prefix    VARCHAR(16) NOT NULL,
        key_hash      VARCHAR(255) NOT NULL,
        scope         VARCHAR(20) NOT NULL DEFAULT 'read'
                      CHECK (scope IN ('read','write','full')),
        board_ids     INTEGER[] DEFAULT NULL,
        last_used_at  TIMESTAMP,
        request_count INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW(),
        is_active     BOOLEAN DEFAULT true
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user   ON api_keys(user_id)`);
    console.log('✅ api_keys table ready');

    // Board views (saved filter sets per board)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_views (
        id          SERIAL PRIMARY KEY,
        board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL DEFAULT 'Main Table',
        type        VARCHAR(50) NOT NULL DEFAULT 'table',
        filters     JSONB NOT NULL DEFAULT '[]',
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_board_views_board ON board_views(board_id)`);
    console.log('✅ board_views table ready');

    const { rows } = await pool.query('SELECT COUNT(*) FROM boards');
    if (parseInt(rows[0].count) === 0) {
      console.log('Running seed data...');
      require('child_process').execSync('node db/seed.js', { stdio: 'inherit', cwd: __dirname });
    }
  } catch (err) {
    console.error('DB connection failed:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
  });
}

start();
