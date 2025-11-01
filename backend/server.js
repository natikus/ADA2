import express from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import pkg from "pg";
import Redis from "ioredis";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: String(process.env.PGPASSWORD),
});

// ---------- Cache-Aside: Redis ----------
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const cacheLogs = [];
const MAX_CACHE_LOGS = 50;

function addCacheLog(type, message, details = {}) {
  const log = {
    timestamp: new Date().toISOString(),
    type: type,
    message: message,
    ...details
  };

  cacheLogs.unshift(log);
  if (cacheLogs.length > MAX_CACHE_LOGS) {
    cacheLogs.pop();
  }

  return log;
}

// funcion helper para cache-aside
async function getCachedOrQuery(cacheKey, queryFn, ttlSeconds = 300) {
  const startTime = Date.now();
  try {
    // aca se intenta obtener desde cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      const responseTime = Date.now() - startTime;
      addCacheLog('HIT', `Datos obtenidos desde caché`, {
        cacheKey,
        responseTime,
        dataSize: cached.length
      });
      console.log(`[CACHE HIT] ${cacheKey} (${responseTime}ms)`);
      return {
        data: JSON.parse(cached),
        cacheStatus: 'HIT',
        responseTime: responseTime,
        cacheKey: cacheKey
      };
    }

    // Cache miss - ejecutar query
    const queryStartTime = Date.now();
    addCacheLog('MISS', `Consultando base de datos`, { cacheKey });
    console.log(`[CACHE MISS] ${cacheKey} - consultando BD...`);
    const result = await queryFn();
    const queryTime = Date.now() - queryStartTime;

    // guardamos en cache
    await redis.setex(cacheKey, ttlSeconds, JSON.stringify(result));

    const totalTime = Date.now() - startTime;
    addCacheLog('STORE', `Datos guardados en caché`, {
      cacheKey,
      ttlSeconds,
      dataSize: JSON.stringify(result).length,
      queryTime,
      totalTime
    });
    console.log(`[CACHE MISS] ${cacheKey} guardado en Redis (query: ${queryTime}ms, total: ${totalTime}ms)`);

    return {
      data: result,
      cacheStatus: 'MISS',
      responseTime: totalTime,
      queryTime: queryTime,
      cacheKey: cacheKey
    };
  } catch (err) {
    const errorTime = Date.now() - startTime;
    addCacheLog('ERROR', `Error en caché: ${err.message}`, {
      cacheKey,
      error: err.message,
      responseTime: errorTime
    });
    console.warn(`[CACHE ERROR] ${cacheKey} (${errorTime}ms):`, err.message);
    // Fallback: ejecutar query sin caché
    // fallback, se ejecuta el query (sin cache) si no anduvo
    const result = await queryFn();
    return {
      data: result,
      cacheStatus: 'ERROR',
      responseTime: Date.now() - startTime,
      error: err.message,
      cacheKey: cacheKey
    };
  }
}

// función para invalidar caché
async function invalidateCache(pattern) {
  try {
    if (pattern === 'libros:all') {
      await redis.del('libros:all');
      addCacheLog('INVALIDATE', `Caché invalidado después de modificación`, {
        pattern: 'libros:all',
        reason: 'nuevo libro creado'
      });
      console.log('[CACHE INVALIDATE] libros:all');
    } else if (pattern.startsWith('libros:search:')) {
      await redis.del(pattern);
      addCacheLog('INVALIDATE', `Caché de búsqueda invalidado`, {
        pattern,
        reason: 'búsqueda específica'
      });
      console.log(`[CACHE INVALIDATE] ${pattern}`);
    }
  } catch (err) {
    addCacheLog('INVALIDATE_ERROR', `Error al invalidar caché: ${err.message}`, {
      pattern,
      error: err.message
    });
    console.warn('[CACHE INVALIDATE ERROR]', err.message);
  }
}

// ---------- Disponibilidad: utilidades ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isTransientPgError(err) {
  // Códigos/errores típicos transitorios (red, timeouts, locks, failover)
  const pgCodes = new Set([
    '40001', // serialization_failure
    '40P01', // deadlock_detected
    '55P03', // lock_not_available
    '53300', // too_many_connections
    '57P01', // admin_shutdown
    '08000', '08001', '08003', '08006', '08004', '08007', // connection issues
  ]);
  if (err && (pgCodes.has(err.code))) return true;

  const m = String(err.message || '').toLowerCase();
  return (
    m.includes('timeout') ||
    m.includes('pool is closed') ||
    m.includes('terminating connection') ||
    m.includes('connection terminated') ||
    m.includes('lost connection') ||
    m.includes('connection refused') ||
    m.includes('read econreset') ||
    m.includes('write epipe') ||
    m.includes('socket hang up')
  );
}

/**
 * query con reintentos (backoff exponencial + jitter)
 * Uso: igual que pool.query(text, params)
 */
const rawQuery = pool.query.bind(pool);
async function queryWithRetry(text, params = [], {
  maxRetries = 3,
  baseDelayMs = 100
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await rawQuery(text, params);
    } catch (err) {
      const canRetry = isTransientPgError(err) && attempt < maxRetries;
      if (!canRetry) throw err;
      const delay = Math.round(baseDelayMs * (2 ** attempt) * (0.5 + Math.random())); // jitter
      attempt++;
      console.warn(`[DB RETRY] intento ${attempt} en ${delay}ms - motivo:`, err.code || err.message);
      await sleep(delay);
    }
  }
}
// Sobrescribimos pool.query para que TODO lo no-transaccional ya tenga reintentos
pool.query = (text, params) => queryWithRetry(text, params);

// Helper para readiness check con timeout "duro"
async function select1WithTimeout(timeoutMs = 1500) {
  const p = pool.query('SELECT 1 as ok');
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error('health-timeout')), timeoutMs));
  return Promise.race([p, t]);
}



// Utilidad simple para manejar transacciones
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------
// Usuarios
// ---------------------------

// Crear usuario
app.post("/usuarios", async (req, res) => {
  try {
    const { correo, clave, nombre_mostrar } = req.body;
    if (!correo || !clave || !nombre_mostrar) {
      return res.status(400).json({ error: "correo, clave y nombre_mostrar son obligatorios" });
    }
    const hash = await bcrypt.hash(clave, 10);
    // Enforce unicidad case-insensitive
    const exists = await pool.query(
      "SELECT 1 FROM usuario WHERE LOWER(correo)=LOWER($1)",
      [correo]
    );
    if (exists.rowCount > 0) return res.status(409).json({ error: "Correo ya registrado" });

    const q = `INSERT INTO usuario (correo, clave_hash, nombre_mostrar, activo)
               VALUES ($1,$2,$3, TRUE)
               RETURNING id_usuario, correo, nombre_mostrar, activo, creado_en`;
    const { rows } = await pool.query(q, [correo, hash, nombre_mostrar]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

// Login básico (solo para test, sin JWT)
app.post("/login", async (req, res) => {
  try {
    const { correo, clave } = req.body;
    const { rows } = await pool.query(
      "SELECT id_usuario, correo, clave_hash, nombre_mostrar, activo FROM usuario WHERE LOWER(correo)=LOWER($1)",
      [correo]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Credenciales inválidas" });
    const ok = await bcrypt.compare(clave, rows[0].clave_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });
    const { clave_hash, ...rest } = rows[0];
    res.json(rest);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error en login" });
  }
});

// ---------------------------
// Libros
// ---------------------------

// Crear libro - CON INVALIDACIÓN DE CACHÉ
app.post("/libros", async (req, res) => {
  try {
    const { isbn_10, isbn_13, titulo, autor, anio_publicacion } = req.body;
    if (!titulo || !autor) return res.status(400).json({ error: "titulo y autor son obligatorios" });
    const q = `INSERT INTO libro (isbn_10, isbn_13, titulo, autor, anio_publicacion)
               VALUES ($1,$2,$3,$4,$5)
               RETURNING id_libro, titulo, autor, anio_publicacion`;
    const { rows } = await pool.query(q, [isbn_10 || null, isbn_13 || null, titulo, autor, anio_publicacion || null]);

    // invalidar caché después de crear libro
    try {
      await redis.del('libros:all');
      console.log('[CACHE INVALIDATE] libros:all');
    } catch (cacheErr) {
      console.warn('[CACHE INVALIDATE ERROR]', cacheErr.message);
    }

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear libro" });
  }
});

// Listar libros (búsqueda simple) - CON CACHE-ASIDE
app.get("/libros", async (req, res) => {
  try {
    const { q } = req.query;

    if (q) {
      // busqueda con parámetro - usar cache con TTL mas corto
      const cacheKey = `libros:search:${q}`;
      const cacheResult = await getCachedOrQuery(cacheKey,
        async () => {
          const { rows } = await pool.query(
            `SELECT id_libro, titulo, autor, anio_publicacion
             FROM libro
             WHERE titulo ILIKE '%'||$1||'%' OR autor ILIKE '%'||$1||'%'
             ORDER BY titulo ASC
             LIMIT 50`, [q]
          );
          return rows;
        },
        180
      );

      res.set({
        'X-Cache-Status': cacheResult.cacheStatus,
        'X-Cache-Key': cacheResult.cacheKey,
        'X-Response-Time': `${cacheResult.responseTime}ms`,
        'X-Cache-TTL': q ? '180s' : '300s'
      });

      if (cacheResult.cacheStatus === 'MISS') {
        res.set('X-Query-Time', `${cacheResult.queryTime}ms`);
      }

      return res.json(cacheResult.data);
    }

    // listado general - usar cache con TTL mas largo
    const cacheKey = 'libros:all';
    const cacheResult = await getCachedOrQuery(cacheKey,
      async () => {
        const { rows } = await pool.query(
          `SELECT id_libro, titulo, autor, anio_publicacion
           FROM libro ORDER BY creado_en DESC LIMIT 50`
        );
        return rows;
      },
      300
    );

    res.set({
      'X-Cache-Status': cacheResult.cacheStatus,
      'X-Cache-Key': cacheResult.cacheKey,
      'X-Response-Time': `${cacheResult.responseTime}ms`,
      'X-Cache-TTL': '300s'
    });

    if (cacheResult.cacheStatus === 'MISS') {
      res.set('X-Query-Time', `${cacheResult.queryTime}ms`);
    }

    res.json(cacheResult.data);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar libros" });
  }
});

// ---------------------------
// Copias (ejemplares)
// ---------------------------

// Crear copia (ejemplar) de un libro
app.post("/copias", async (req, res) => {
  try {
    const { id_libro, id_duenio, estado = "BUENO", notas = null, visibilidad = "PUBLICA" } = req.body;
    if (!id_libro || !id_duenio) return res.status(400).json({ error: "id_libro e id_duenio son obligatorios" });
    const q = `INSERT INTO copia (id_libro, id_duenio, estado, notas, visibilidad, disponible)
               VALUES ($1,$2,$3,$4,$5, TRUE)
               RETURNING id_copia, id_libro, id_duenio, estado, visibilidad, disponible`;
    const { rows } = await pool.query(q, [id_libro, id_duenio, estado, notas, visibilidad]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear copia" });
  }
});

// Listar copias (filtros opcionales)
app.get("/copias", async (req, res) => {
  try {
    const { disponible, id_libro } = req.query;
    const conds = [];
    const params = [];
    if (typeof disponible !== "undefined") {
      params.push(disponible === "1" || disponible === "true");
      conds.push(`disponible = $${params.length}`);
    }
    if (id_libro) {
      params.push(Number(id_libro));
      conds.push(`id_libro = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT c.id_copia, c.id_libro, l.titulo, l.autor, c.id_duenio, c.estado, c.visibilidad, c.disponible
       FROM copia c JOIN libro l ON l.id_libro = c.id_libro
       ${where}
       ORDER BY c.creado_en DESC
       LIMIT 100`, params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar copias" });
  }
});

// ---------------------------
// Solicitudes de préstamo
// ---------------------------

// Listar solicitudes
// Listar solicitudes (enriquecidas)
app.get("/solicitudes", async (req, res) => {
  try {
    const { rows } = await pool.query(`
SELECT
  s.id_solicitud, s.estado, s.solicitada_en, s.decidida_en,
  s.id_copia, c.id_libro,
  l.titulo AS titulo,   
  l.autor  AS autor,   
  s.id_solicitante, us.nombre_mostrar AS solicitante,
  s.id_duenio,      ud.nombre_mostrar AS duenio
FROM solicitud s
JOIN copia c  ON c.id_copia = s.id_copia
JOIN libro l  ON l.id_libro = c.id_libro
JOIN usuario us ON us.id_usuario = s.id_solicitante
JOIN usuario ud ON ud.id_usuario = s.id_duenio
ORDER BY s.id_solicitud DESC
LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar solicitudes" });
  }
});


// Crear solicitud
app.post("/solicitudes", async (req, res) => {
  try {
    const { id_copia, id_solicitante, mensaje = null } = req.body;
    if (!id_copia || !id_solicitante) {
      return res.status(400).json({ error: "id_copia e id_solicitante son obligatorios" });
    }
    // Traer dueño de la copia y estado
    const { rows: copiaRows } = await pool.query(
      "SELECT id_duenio, disponible FROM copia WHERE id_copia=$1", [id_copia]
    );
    if (copiaRows.length === 0) return res.status(404).json({ error: "Copia no encontrada" });
    const duenio = copiaRows[0].id_duenio;
    if (duenio === Number(id_solicitante)) {
      return res.status(400).json({ error: "No puedes solicitar tu propia copia" });
    }
    const q = `INSERT INTO solicitud (id_copia, id_solicitante, id_duenio, estado, mensaje)
               VALUES ($1,$2,$3,'PENDIENTE',$4)
               RETURNING id_solicitud, estado, solicitada_en`;
    const { rows } = await pool.query(q, [id_copia, id_solicitante, duenio, mensaje]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear solicitud" });
  }
});

// Aceptar solicitud -> crea préstamo
app.post("/solicitudes/:id/aceptar", async (req, res) => {
  const id_solicitud = Number(req.params.id);
  const { fecha_inicio, fecha_vencimiento } = req.body;
  if (!fecha_inicio || !fecha_vencimiento) {
    return res.status(400).json({ error: "fecha_inicio y fecha_vencimiento son obligatorias" });
  }

  try {
    const result = await withTx(async (client) => {
      // Bloquear solicitud
      const { rows: sRows } = await client.query(
        `SELECT id_solicitud, id_copia, id_solicitante, id_duenio, estado
         FROM solicitud WHERE id_solicitud=$1 FOR UPDATE`, [id_solicitud]
      );
      if (sRows.length === 0) throw { status: 404, msg: "Solicitud no encontrada" };
      const sol = sRows[0];
      if (sol.estado !== "PENDIENTE") throw { status: 409, msg: "La solicitud no está pendiente" };

      // Insertar préstamo (índice único evita 2 activos por copia)
      const insertLoan = `INSERT INTO prestamo
          (id_copia, id_duenio, id_prestatario, id_solicitud, estado, fecha_inicio, fecha_vencimiento)
        VALUES ($1,$2,$3,$4,'ACTIVO',$5,$6)
        RETURNING id_prestamo, id_copia, estado, fecha_inicio, fecha_vencimiento`;
      const { rows: pRows } = await client.query(insertLoan, [
        sol.id_copia, sol.id_duenio, sol.id_solicitante, sol.id_solicitud, fecha_inicio, fecha_vencimiento
      ]);

      // Marcar solicitud como aceptada
      await client.query(
        "UPDATE solicitud SET estado='ACEPTADA', decidida_en=now() WHERE id_solicitud=$1",
        [id_solicitud]
      );

      // (Opcional) actualizar disponible a false (si no tenés trigger)
      await client.query(
        `UPDATE copia SET disponible = FALSE WHERE id_copia=$1`,
        [sol.id_copia]
      );

      // Evento
      await client.query(
        `INSERT INTO evento_prestamo (id_prestamo, tipo_evento, datos)
         VALUES ($1,'CREADO', '{"origen":"aceptar_solicitud"}')`,
        [pRows[0].id_prestamo]
      );

      return pRows[0];
    });

    res.json(result);
  } catch (e) {
    console.error(e);
    if (e.code === "23505") {
      // violación de índice único: ya hay un préstamo ACTIVO/ATRASADO
      return res.status(409).json({ error: "La copia ya tiene un préstamo activo" });
    }
    const status = e.status || 500;
    res.status(status).json({ error: e.msg || "Error al aceptar solicitud" });
  }
});

// Rechazar / Cancelar solicitud
app.post("/solicitudes/:id/rechazar", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE solicitud SET estado='RECHAZADA', decidida_en=now()
       WHERE id_solicitud=$1 AND estado='PENDIENTE'`, [req.params.id]
    );
    if (rowCount === 0) return res.status(409).json({ error: "No se pudo rechazar (¿ya decidida?)" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al rechazar solicitud" });
  }
});
// Listar usuarios
app.get("/usuarios", async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT id_usuario, correo, nombre_mostrar, activo, creado_en FROM usuario ORDER BY id_usuario ASC"
      );
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Error al listar usuarios" });
    }
  });
  
// ---------------------------
// Préstamos
// ---------------------------

// Listar préstamos (filtros básicos)
app.get("/prestamos", async (req, res) => {
  try {
    const { id_usuario, estado } = req.query;
    const conds = [];
    const params = [];
    if (id_usuario) {
      params.push(Number(id_usuario));
      conds.push(`(p.id_prestatario = $${params.length} OR p.id_duenio = $${params.length})`);
    }
    if (estado) {
      params.push(estado);
      conds.push(`p.estado = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const q = `
      SELECT p.id_prestamo, p.id_copia, p.id_duenio, p.id_prestatario,
             p.estado, p.fecha_inicio, p.fecha_vencimiento, p.fecha_devolucion,
             l.titulo, l.autor
      FROM prestamo p
      JOIN copia c ON c.id_copia = p.id_copia
      JOIN libro l ON l.id_libro = c.id_libro
      ${where}
      ORDER BY p.id_prestamo DESC
      LIMIT 100`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar préstamos" });
  }
});

// Devolver un préstamo
app.post("/prestamos/:id/devolver", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await withTx(async (client) => {
      // Bloquear préstamo
      const { rows } = await client.query(
        `SELECT id_prestamo, id_copia, estado FROM prestamo WHERE id_prestamo=$1 FOR UPDATE`, [id]
      );
      if (rows.length === 0) throw { status: 404, msg: "Préstamo no encontrado" };
      const p = rows[0];
      if (p.estado === "DEVUELTO") throw { status: 409, msg: "Ya está devuelto" };

      // Actualizar préstamo
      await client.query(
        `UPDATE prestamo SET estado='DEVUELTO', fecha_devolucion = CURRENT_DATE
         WHERE id_prestamo=$1`, [id]
      );

      // Marcar copia disponible
      await client.query(`UPDATE copia SET disponible = TRUE WHERE id_copia=$1`, [p.id_copia]);

      // Evento
      await client.query(
        `INSERT INTO evento_prestamo (id_prestamo, tipo_evento, datos)
         VALUES ($1,'DEVUELTO','{}')`, [id]
      );

      return { ok: true };
    });

    res.json(result);
  } catch (e) {
    console.error(e);
    const status = e.status || 500;
    res.status(status).json({ error: e.msg || "Error al devolver" });
  }
});
// ---------- Health Endpoints ----------

// Liveness: ¿el proceso está vivo?
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    uptime_s: process.uptime(),
    now: new Date().toISOString()
  });
});

// Readiness: ¿la app puede servir tráfico (DB OK)?
app.get('/readyz', async (req, res) => {
  const started = Date.now();
  try {
    await select1WithTimeout(1500);
    return res.json({
      status: 'ready',
      db: 'ok',
      latency_ms: Date.now() - started,
      now: new Date().toISOString()
    });
  } catch (err) {
    console.error('[READYZ] fallo:', err.message);
    return res.status(503).json({
      status: 'not-ready',
      db: 'down',
      error: err.message,
      latency_ms: Date.now() - started
    });
  }
});

// endpoint para monitorear el estado del cache
app.get('/cachez', async (req, res) => {
  try {
    const cacheStats = {
      redis_connected: false,
      cache_keys: [],
      cache_info: null
    };

    // verificar conexion a redis
    await redis.ping();
    cacheStats.redis_connected = true;

    // obtener todas las claves relacionadas con libros
    const keys = await redis.keys('libros:*');
    cacheStats.cache_keys = keys;

    // obtener informacion de cada clave
    const cacheInfo = {};
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      const value = await redis.get(key);
      cacheInfo[key] = {
        ttl: ttl,
        size: value ? value.length : 0,
        has_data: !!value
      };
    }
    cacheStats.cache_info = cacheInfo;

    res.json(cacheStats);
  } catch (err) {
    console.error('[CACHEZ] fallo:', err.message);
    res.status(503).json({
      redis_connected: false,
      error: err.message
    });
  }
});

// endpoint para ver logs recientes del caché
app.get('/cachelogs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20; // por defecto últimos 20 logs
    const type = req.query.type; // filtrar por tipo (HIT, MISS, STORE, etc.

    let logs = [...cacheLogs];

    // filtrar por tipo si se especifica
    if (type) {
      logs = logs.filter(log => log.type === type);
    }

    // limitar cantidad
    logs = logs.slice(0, Math.min(limit, MAX_CACHE_LOGS));

    res.json({
      total_logs: cacheLogs.length,
      logs_returned: logs.length,
      filter: type ? { type } : null,
      logs: logs
    });
  } catch (err) {
    console.error('[CACHELOGS] error:', err.message);
    res.status(500).json({
      error: 'Error al obtener logs del caché',
      details: err.message
    });
  }
});


// ---------------------------

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`API escuchando en http://${host}:${port}`);
});
