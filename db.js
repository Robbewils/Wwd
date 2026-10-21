'use strict';
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const Database = require('better-sqlite3');

const scrypt = promisify(crypto.scrypt);
// Wachtwoord-hashing (scrypt zit in Node). Wijzig je deze waarden, dan werken bestaande hashes niet meer.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

// Nep-hash: zo kost een onbekende gebruikersnaam evenveel tijd als een bekende.
const DUMMY_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    email          TEXT UNIQUE COLLATE NOCASE,
    role           TEXT NOT NULL CHECK (role IN ('klant', 'admin')),
    created_at     INTEGER NOT NULL,
    payment_needed BOOLEAN NOT NULL DEFAULT 0,
    notes          TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_requests (
    id                INTEGER PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'closed')),
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    service_type      TEXT NOT NULL CHECK (service_type IN ('new_site_basic', 'new_site_premium', 'new_site_max', 'maintenance', 'other')),
    payment_completed BOOLEAN NOT NULL DEFAULT 0,
    payment_date      INTEGER,
    admin_notes       TEXT
  );
  CREATE TABLE IF NOT EXISTS revenue (
    id            INTEGER PRIMARY KEY,
    amount        REAL NOT NULL,
    profit        REAL,
    date          INTEGER NOT NULL,
    request_id    INTEGER REFERENCES service_requests(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id INTEGER REFERENCES service_requests(id) ON DELETE CASCADE,
    rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment    TEXT,
    created_at INTEGER NOT NULL
  );
`);

// Add columns used by current features to databases created by older versions.
function ensureColumn(table, column, definition) {
  const columns = new Set(db.pragma(`table_info(${table})`).map((entry) => entry.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('users', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'email', 'TEXT');
ensureColumn('users', 'payment_needed', 'BOOLEAN NOT NULL DEFAULT 0');
ensureColumn('service_requests', 'title', "TEXT NOT NULL DEFAULT ''");
ensureColumn('service_requests', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('service_requests', 'service_type', "TEXT NOT NULL DEFAULT 'other'");
ensureColumn('service_requests', 'payment_completed', 'BOOLEAN NOT NULL DEFAULT 0');
ensureColumn('service_requests', 'payment_date', 'INTEGER');
ensureColumn('service_requests', 'admin_notes', 'TEXT');
ensureColumn('revenue', 'date', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('revenue', 'profit', 'REAL');
ensureColumn('revenue', 'request_id', 'INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS revenue_request_id_unique ON revenue(request_id) WHERE request_id IS NOT NULL');
db.exec(`
  UPDATE users
  SET payment_needed = EXISTS (
    SELECT 1 FROM service_requests r
    WHERE r.user_id = users.id AND r.status = 'closed' AND r.payment_completed = 0
  );

  CREATE TRIGGER IF NOT EXISTS sync_payment_needed_after_request_insert
  AFTER INSERT ON service_requests
  BEGIN
    UPDATE users
    SET payment_needed = EXISTS (
      SELECT 1 FROM service_requests r
      WHERE r.user_id = NEW.user_id AND r.status = 'closed' AND r.payment_completed = 0
    )
    WHERE id = NEW.user_id;
  END;

  CREATE TRIGGER IF NOT EXISTS sync_payment_needed_after_request_update
  AFTER UPDATE OF user_id, status, payment_completed ON service_requests
  BEGIN
    UPDATE users
    SET payment_needed = EXISTS (
      SELECT 1 FROM service_requests r
      WHERE r.user_id = NEW.user_id AND r.status = 'closed' AND r.payment_completed = 0
    )
    WHERE id = NEW.user_id;

    UPDATE users
    SET payment_needed = EXISTS (
      SELECT 1 FROM service_requests r
      WHERE r.user_id = OLD.user_id AND r.status = 'closed' AND r.payment_completed = 0
    )
    WHERE id = OLD.user_id AND OLD.user_id <> NEW.user_id;
  END;

  CREATE TRIGGER IF NOT EXISTS sync_payment_needed_after_request_delete
  AFTER DELETE ON service_requests
  BEGIN
    UPDATE users
    SET payment_needed = EXISTS (
      SELECT 1 FROM service_requests r
      WHERE r.user_id = OLD.user_id AND r.status = 'closed' AND r.payment_completed = 0
    )
    WHERE id = OLD.user_id;
  END;
`);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':').map((h) => Buffer.from(h, 'hex'));
  const test = await scrypt(password, salt, key.length, SCRYPT);
  return crypto.timingSafeEqual(test, key);
}

module.exports = { db, hashPassword, verifyPassword, DUMMY_HASH };
