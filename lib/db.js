// MineSwap DB layer — mysql2/promise pool over TiDB Cloud (TLS).
// Credentials come ONLY from env vars. The pool is created lazily so
// `node --check` and the pure-logic tests never touch the database.
'use strict';

const { config } = require('./config');

let pool = null;

function getPool() {
  if (pool) return pool;
  // Lazy require: importing this module must not fail when mysql2 is absent.
  const mysql = require('mysql2/promise');
  if (!config.dbHost || !config.dbUser) {
    throw new Error('Database not configured (DB_HOST / DB_USER missing)');
  }
  pool = mysql.createPool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPass,
    database: config.dbName,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    ssl: config.dbSsl ? { rejectUnauthorized: true } : undefined,
    timezone: '+06:00',
  });
  return pool;
}

async function query(sql, params = []) {
  const p = getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

async function run(sql, params = []) {
  const p = getPool();
  const [res] = await p.execute(sql, params);
  return res;
}

// Run a callback inside a transaction. The callback receives a connection
// with execute(); commit on success, rollback on error.
async function withTx(fn) {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { getPool, query, getOne, run, withTx };
