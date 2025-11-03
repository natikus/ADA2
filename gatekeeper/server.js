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

// Simplified: allow all headers for health endpoints
app.use((req, res, next) => {
  // Skip ALL validation for health endpoints
  if (['/healthz', '/readyz', '/cachez', '/cachelogs', '/cqrsz', '/gatekeeperz'].includes(req.path)) {
    return next();
  }


  // For other endpoints, check headers
  const allowedHeaders = new Set([
    // Basic headers
    'host','connection','content-type','content-length','accept','accept-encoding','accept-language',
    'origin','referer','user-agent','authorization','x-request-id','cache-control','pragma',

    // Security headers (Chrome, Firefox, Safari)
    'sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-fetch-user','sec-ch-ua','sec-ch-ua-mobile',
    'sec-ch-ua-platform','sec-purpose','dnt','upgrade-insecure-requests','priority',

    // Conditional headers
    'accept-ranges','range','if-none-match','if-modified-since','last-modified','etag','expires','age','via',

    // Proxy/load balancer headers
    'x-forwarded-for','x-forwarded-proto','x-forwarded-host','x-real-ip','x-amzn-trace-id',
    'x-cloud-trace-context','x-b3-traceid','x-b3-spanid','x-b3-parentspanid','x-b3-sampled',
    'x-b3-flags','x-ot-span-context','x-request-start','x-envoy-attempt-count','x-envoy-upstream-service-time',

    // Common browser headers
    'accept-charset','accept-datetime','access-control-request-method','access-control-request-headers',
    'cookie','date','expect','forwarded','from','max-forwards','proxy-authorization','te','trailer','transfer-encoding',
    'warning','x-correlation-id','x-csrf-token','x-http-method-override','x-powered-by','x-ratelimit-limit',
    'x-ratelimit-remaining','x-ratelimit-reset','x-ua-compatible',

    // Additional modern browser headers
    'sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-fetch-user','sec-ch-ua','sec-ch-ua-mobile',
    'sec-ch-ua-platform','sec-purpose','dnt','upgrade-insecure-requests','priority','accept-ranges',
    'range','if-none-match','if-modified-since','last-modified','etag','expires','age','via',

    // More browser headers
    'accept-encoding','accept-language','cache-control','connection','host','pragma','referer','user-agent',
    'x-requested-with','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-real-ip'
  ]);

  for (const [k] of Object.entries(req.headers)) {
    if (!allowedHeaders.has(k.toLowerCase())) {
      console.log(`[HEADER BLOCKED] ${k}: ${req.headers[k]} (path: ${req.path})`);
      blockedCount++;
      console.log(`[BLOCKED] Total blocked: ${blockedCount}`);
      return res.status(400).json({ error: `header not allowed: ${k}` });
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
  { method: 'GET', path: /^\/(healthz|readyz|cachez|cachelogs|cqrsz|gatekeeperz)$/ },
  { method: 'HEAD', path: /^\/(healthz|readyz|cachez|cachelogs|cqrsz)$/ },
  { method: 'GET', path: /^\/favicon\.ico$/ }, // Allow favicon to prevent false blocked counts
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

// health endpoints - proxy to backend (don't override, let proxy handle it)
app.get('/readyz', async (_req, res) => {
  try {
    const r = await fetch(`${TARGET}/healthz`).then(r=>r.json());
    res.json({ status: 'ready', backend: r });
  } catch (e) { res.status(503).json({ status: 'not-ready', error: String(e) }); }
});

app.get('/gatekeeperz', (_req, res) => {
  const response = JSON.stringify({ passed: passedCount, blocked: blockedCount, target: TARGET, cors_allowed: ALLOWED_ORIGINS });
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(response);
});

// proxy para todo lo demás
console.log('[STARTUP] Setting up proxy middleware');
const proxy = (req, res, next) => {
  console.log(`[PROXY] ${req.method} ${req.path} -> ${TARGET}${req.path}`);

  const proxyMiddleware = createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    xfwd: true,
    timeout: 10000,
    proxyTimeout: 10000,
    on: {
      proxyRes: (proxyRes, req, res) => {
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
          passedCount++;
          console.log(`[PROXY SUCCESS] ${req.method} ${req.path} - passed: ${passedCount}`);
        }
      },
      error: (err, req, res) => {
        console.error(`[PROXY ERROR] ${req.method} ${req.path}:`, err.message);
        if (res && !res.headersSent) {
          res.status(502).json({ error: 'Proxy error', details: err.message });
        }
      }
    }
  });

  return proxyMiddleware(req, res, next);
};

app.use('/', proxy);

app.listen(PORT, () => {
  console.log();
});
