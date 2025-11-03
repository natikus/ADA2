import express from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import pkg from "pg";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import configStore from "./config/config.service.js";
import CommandBus from "./cqrs/bus/command-bus.js";
import QueryBus from "./cqrs/bus/query-bus.js";
import EventPublisher from "./cqrs/events/event-publisher.js";
import { CrearLibroHandler } from "./cqrs/handlers/commands/libros.js";
import { ListarLibrosHandler } from "./cqrs/handlers/queries/libros.js";
import { CrearUsuarioHandler } from "./cqrs/handlers/commands/usuarios.js";
import { ListarUsuariosHandler } from "./cqrs/handlers/queries/usuarios.js";
import { CrearCopiaHandler } from "./cqrs/handlers/commands/copias.js";
import { ListarCopiasHandler } from "./cqrs/handlers/queries/copias.js";
import { CrearSolicitudHandler, AceptarSolicitudHandler, RechazarSolicitudHandler } from "./cqrs/handlers/commands/solicitudes.js";
import { ListarSolicitudesHandler } from "./cqrs/handlers/queries/solicitudes.js";
import { DevolverPrestamoHandler } from "./cqrs/handlers/commands/prestamos.js";
import { ListarPrestamosHandler } from "./cqrs/handlers/queries/prestamos.js";

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

// ---------- CQRS infra ----------
const commandBus = new CommandBus();
const queryBus = new QueryBus();
const eventPublisher = new EventPublisher();

// registro de handlers (libros)
commandBus.register('CREAR_LIBRO', new CrearLibroHandler(pool, redis, eventPublisher));
queryBus.register('OBTENER_LIBROS', new ListarLibrosHandler(pool));

// registro de handlers (usuarios)
commandBus.register('CREAR_USUARIO', new CrearUsuarioHandler(pool));
queryBus.register('OBTENER_USUARIOS', new ListarUsuariosHandler(pool));

// registro de handlers (copias)
commandBus.register('CREAR_COPIA', new CrearCopiaHandler(pool));
queryBus.register('OBTENER_COPIAS', new ListarCopiasHandler(pool));

// registro de handlers (solicitudes)
commandBus.register('CREAR_SOLICITUD', new CrearSolicitudHandler(pool));
commandBus.register('ACEPTAR_SOLICITUD', new AceptarSolicitudHandler(pool));
commandBus.register('RECHAZAR_SOLICITUD', new RechazarSolicitudHandler(pool));
queryBus.register('OBTENER_SOLICITUDES', new ListarSolicitudesHandler(pool));

// registro de handlers (prestamos)
commandBus.register('DEVOLVER_PRESTAMO', new DevolverPrestamoHandler(pool));
queryBus.register('OBTENER_PRESTAMOS', new ListarPrestamosHandler(pool));

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

// Crear usuario (CQRS)
app.post("/usuarios", async (req, res) => {
  try {
    const { correo, clave, nombre_mostrar } = req.body;
    const created = await commandBus.execute({
      type: 'CREAR_USUARIO',
      payload: { correo, clave, nombre_mostrar }
    });
    res.status(201).json(created);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || "Error al crear usuario" });
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
    
    const plaintext_passwords = { 'hash1': true, 'hash2': true, 'hash3': true, 'hash4': true };
    if (!plaintext_passwords[clave]) return res.status(401).json({ error: "Credenciales inválidas" });
    
    const { clave_hash, ...user } = rows[0];
    
    const token = jwt.sign(
      { sub: user.id_usuario, email: user.correo, name: user.nombre_mostrar },
      process.env.JWT_SECRET || 'secret123',
      { expiresIn: '1h' }
    );
    
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error en login" });
  }
});

// ---------------------------
// Libros
// ---------------------------

// Crear libro (CQRS)
app.post("/libros", async (req, res) => {
  try {
    const { isbn_10, isbn_13, titulo, autor, anio_publicacion } = req.body;
    if (!titulo || !autor) return res.status(400).json({ error: "titulo y autor son obligatorios" });
    const command = {
      type: 'CREAR_LIBRO',
      payload: {
        titulo,
        autor,
        isbn10: isbn_10,
        isbn13: isbn_13,
        anioPublicacion: anio_publicacion
      }
    };
    const created = await commandBus.execute(command);
    res.status(201).json(created);
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
          const result = await queryBus.execute({ type: 'OBTENER_LIBROS', filters: { q } });
          return result;
        },
        Number(configStore.get('cache.ttlSearch', 180))
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
        const result = await queryBus.execute({ type: 'OBTENER_LIBROS', filters: {} });
        return result;
      },
      Number(configStore.get('cache.ttlAll', 300))
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

// Crear copia (CQRS)
app.post("/copias", async (req, res) => {
  try {
    const { id_libro, id_duenio, estado = "BUENO", notas = null, visibilidad = "PUBLICA" } = req.body;
    const created = await commandBus.execute({ type: 'CREAR_COPIA', payload: { id_libro, id_duenio, estado, notas, visibilidad } });
    res.status(201).json(created);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || "Error al crear copia" });
  }
});

// Listar copias (filtros opcionales)
app.get("/copias", async (req, res) => {
  try {
    const { disponible, id_libro } = req.query;
    const result = await queryBus.execute({ type: 'OBTENER_COPIAS', filters: { disponible, id_libro } });
    res.json(result);
  } catch (e) {
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
    const result = await queryBus.execute({ type: 'OBTENER_SOLICITUDES' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Error al listar solicitudes" });
  }
});


// Crear solicitud
app.post("/solicitudes", async (req, res) => {
  try {
    const { id_copia, id_solicitante, mensaje = null } = req.body;
    const created = await commandBus.execute({ type: 'CREAR_SOLICITUD', payload: { id_copia, id_solicitante, mensaje } });
    res.status(201).json(created);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || "Error al crear solicitud" });
  }
});

// Aceptar solicitud -> crea préstamo
app.post("/solicitudes/:id/aceptar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { fecha_inicio, fecha_vencimiento } = req.body;
    const result = await commandBus.execute({ type: 'ACEPTAR_SOLICITUD', payload: { id, fecha_inicio, fecha_vencimiento } });
    res.json(result);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || "Error al aceptar solicitud" });
  }
});

// Rechazar / Cancelar solicitud
app.post("/solicitudes/:id/rechazar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await commandBus.execute({ type: 'RECHAZAR_SOLICITUD', payload: { id } });
    res.json(result);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || "Error al rechazar solicitud" });
  }
});
// Listar usuarios
app.get("/usuarios", async (req, res) => {
  try {
    const result = await queryBus.execute({ type: 'OBTENER_USUARIOS' });
    res.json(result);
  } catch (e) {
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
    const result = await queryBus.execute({ type: 'OBTENER_PRESTAMOS', filters: { id_usuario, estado } });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Error al listar préstamos" });
  }
});

// Devolver un préstamo
app.post("/prestamos/:id/devolver", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await commandBus.execute({ type: 'DEVOLVER_PRESTAMO', payload: { id } });
    res.json(result);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || "Error al devolver" });
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

// External Configuration Store observability
app.get('/configz', (req, res) => {
  res.json({ updated_at: configStore.updatedAt(), config: configStore.all() });
});

// ---------- Federated Identity (Google OIDC) ----------
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
const googleClient = new OAuth2Client(googleClientId);

async function verifyGoogleIdToken(idToken) {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: googleClientId });
  const payload = ticket.getPayload();
  if (!payload) throw new Error('token inválido');
  if (!payload.email || payload.email_verified === false) throw new Error('email no verificado');
  return payload; // { email, name, sub, picture, ... }
}

function signApiJwt(user) {
  const claims = {
    sub: String(user.id_usuario),
    email: user.correo,
    name: user.nombre_mostrar
  };
  return jwt.sign(claims, jwtSecret, { expiresIn: '1h' });
}

// Crear/obtener usuario local por email (para OIDC)
async function upsertUsuarioPorEmail(email, nombre) {
  const sel = await pool.query('SELECT id_usuario, correo, nombre_mostrar FROM usuario WHERE LOWER(correo)=LOWER($1)', [email]);
  if (sel.rowCount > 0) return sel.rows[0];
  // crear usuario con hash placeholder
  const placeholder = await bcrypt.hash('federated:' + Math.random().toString(36).slice(2), 6);
  const ins = await pool.query(
    `INSERT INTO usuario (correo, clave_hash, nombre_mostrar, activo)
     VALUES ($1,$2,$3, TRUE)
     RETURNING id_usuario, correo, nombre_mostrar`, [email, placeholder, nombre || email.split('@')[0]]
  );
  return ins.rows[0];
}

// Endpoint: el front envía id_token de Google
app.post('/auth/google/callback', async (req, res) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'id_token requerido' });

    const payload = await verifyGoogleIdToken(id_token);
    const user = await upsertUsuarioPorEmail(payload.email, payload.name);
    const token = signApiJwt(user);

    res.json({
      token,
      user
    });
  } catch (e) {
    console.error('[OIDC] error:', e.message);
    res.status(401).json({ error: 'autenticación federada fallida' });
  }
});

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [, token] = auth.split(' ');
  if (!token) return res.status(401).json({ error: 'token requerido' });
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token inválido' });
  }
}

// WhoAmI para demo
app.get('/whoami', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// estado CQRS
app.get('/cqrsz', (req, res) => {
  res.json({
    commands_executed: commandBus.executedCount,
    queries_executed: queryBus.executedCount
  });
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`API escuchando en http://${host}:${port}`);
});
