// db.js
import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: String(process.env.PGPASSWORD),
});

// breaker mínimo
let failCount = 0;
let openedUntil = 0;
const OPEN_MS = 5000;
const MAX_FAILS = 5;

function transient(err) {
  return [
    "57P01", // admin_shutdown
    "53300", // too_many_connections
    "ETIMEDOUT", "ECONNRESET", "EPIPE"
  ].includes(err?.code) || /timeout|reset|closed/i.test(err?.message || "");
}

export async function queryWithRetry(sql, params = [], maxRetries = 3) {
  if (Date.now() < openedUntil) {
    const err = new Error("DB circuit open");
    err.code = "CIRCUIT_OPEN";
    throw err;
  }
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await pool.query(sql, params);
      failCount = 0;
      return res;
    } catch (e) {
      lastErr = e;
      if (!transient(e) || i === maxRetries) break;
      await new Promise(r => setTimeout(r, 200 * Math.pow(2, i))); // backoff
    }
  }
  failCount++;
  if (failCount >= MAX_FAILS) {
    openedUntil = Date.now() + OPEN_MS;
    failCount = 0;
  }
  throw lastErr;
}

export async function withTxRetry(fn, retries = 2) {
  const client = await pool.connect();
  try {
    for (let i = 0; i <= retries; i++) {
      try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        if (transient(e) && i < retries) {
          await new Promise(r => setTimeout(r, 200 * Math.pow(2, i)));
          continue;
        }
        throw e;
      }
    }
  } finally {
    client.release();
  }
}
