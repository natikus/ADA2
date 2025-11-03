import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 3000;
const TARGET = process.env.GATEKEEPER_TARGET || 'http://localhost:3001';
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4200').split(',');
const RATE_WINDOW_MIN = parseInt(process.env.RATE_WINDOW_MIN || '15');
const RATE_MAX = parseInt(process.env.RATE_MAX || '100');

// metrics
let blockedCount = 0;
let passedCount = 0;

// request id
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// security headers
app.use(helmet());

// cors strict
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    blockedCount++;
    return cb(new Error('CORS not allowed'), false);
  },
  credentials: true
}));

// logging
app.use(morgan(':method :url :status - reqid=:req[id] - :response-time ms', {
  immediate: false,
  stream: { write: (str) => process.stdout.write(str) }
}));

// payload limits
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

// rate limit
const limiter = rateLimit({
  windowMs: RATE_WINDOW_MIN * 60 * 1000,
  max: RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => { blockedCount++; res.status(429).json({ error: 'rate limit exceeded' }); }
});
app.use(limiter);

// header allowlist
const allowedHeaders = new Set(['host','connection','content-type','content-length','accept','accept-encoding','accept-language','origin','referer','user-agent','authorization','x-request-id']);
app.use((req, res, next) => {
  for (const [k] of Object.entries(req.headers)) {
    if (!allowedHeaders.has(k.toLowerCase())) {
      blockedCount++;
      return res.status(400).json({ error: 'header not allowed' });
    }
  }
  next();
});

// simple sanitization
function stripDangerous(obj){
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor') delete obj[key];
    else stripDangerous(obj[key]);
  }
  return obj;
}
app.use((req, _res, next) => {
  stripDangerous(req.body);
  stripDangerous(req.query);
  next();
});

// allowlist de rutas y métodos
const allowlist = [
  { method: 'GET', path: /^\/(healthz|readyz|cachez|cachelogs|cqrsz)$/ },
  { method: 'GET', path: /^\/(usuarios|libros|copias|solicitudes|prestamos)(\/.*)?$/ },
  { method: 'POST', path: /^\/(usuarios|libros|copias|solicitudes)(\/.*)?$/ },
  { method: 'POST', path: /^\/login$/ },
  { method: 'POST', path: /^\/prestamos\/[0-9]+\/devolver$/ },
  { method: 'POST', path: /^\/solicitudes\/[0-9]+\/(aceptar|rechazar)$/ },
  { method: 'POST', path: /^\/auth\/google\/callback$/ },
  { method: 'GET', path: /^\/whoami$/ }
];

app.use((req, res, next) => {
  console.log(`[ALLOWLIST] ${req.method} ${req.path}`);
  const ok = allowlist.some(rule => {
    const match = rule.method === req.method && rule.path.test(req.path);
    if (match) console.log(`[ALLOWLIST] ✓ Matched rule: ${rule.method} ${rule.path}`);
    return match;
  });
  if (!ok) {
    console.log(`[ALLOWLIST] ✗ BLOCKED ${req.method} ${req.path}`);
    blockedCount++;
    return res.status(405).json({ error: 'method or path not allowed' });
  }
  next();
});

// health endpoints del gatekeeper (registrar ANTES del proxy para que matcheen primero)
app.get('/healthz', (_req, res) => { res.json({ status: 'ok', now: new Date().toISOString() }); });
app.get('/readyz', async (_req, res) => {
  try {
    const r = await fetch(`${TARGET}/healthz`).then(r=>r.json());
    res.json({ status: 'ready', backend: r });
  } catch (e) { res.status(503).json({ status: 'not-ready', error: String(e) }); }
});

app.get('/gatekeeperz', (_req, res) => {
  res.json({ passed: passedCount, blocked: blockedCount, target: TARGET, cors_allowed: ALLOWED_ORIGINS });
});

// proxy para todo lo demás
const proxy = createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  xfwd: true,
  timeout: 10000,
  proxyTimeout: 10000,
  onProxyReq: (proxyReq, req, _res) => {
    passedCount++;
    console.log(`[PROXY] ${req.method} ${req.path} -> ${TARGET}${req.path}`);
  },
  onProxyRes: (proxyRes, req, _res) => {
    console.log(`[PROXY] ${req.method} ${req.path} <- ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error(`[PROXY ERROR] ${req.method} ${req.path}:`, err.message);
    res.status(502).json({ error: 'Proxy error', details: err.message });
  }
});

app.use('/', proxy);

app.listen(PORT, () => {
  console.log();
});
