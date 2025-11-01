# Patrón Gatekeeper - Guía de demostración (Frontend + Navegador)

Este documento muestra cómo evidenciar el patrón **Gatekeeper** agregado delante de la API. El Gatekeeper es un proxy con validaciones y controles básicos que se ejecuta como un servicio aparte en Docker y reenvía el tráfico a la API sólo cuando la solicitud es válida.

## 🎯 Objetivo
- Interponer una capa de seguridad entre clientes y la API confiable
- Validar y sanitizar solicitudes antes del backend
- Mostrar evidencias claras desde el navegador (sin Postman)

## 🏗️ Arquitectura
- Servicio `gatekeeper` escucha en `http://localhost:3000`
- Reenvía a la API `app:3000` dentro de la red Docker
- El frontend (Angular) apunta a `http://localhost:3000` (proxy ya ajustado)

## 🔐 Controles implementados (básico)
- CORS estricto (allowlist: `http://localhost:4200`)
- Límite de tamaño de payload (200kb)
- Rate limiting en memoria (100 req / 15 min por IP)
- Header allowlist (bloquea headers inesperados)
- Allowlist de rutas/métodos permitidos
- Sanitización básica de body/query (`__proto__`, `constructor`)
- Logging con `X-Request-Id`
- Endpoints del Gatekeeper:
  - `/healthz` (vivo)
  - `/readyz` (verifica backend)
  - `/gatekeeperz` (métricas: `passed` y `blocked`)

## ▶️ Puesta en marcha
```bash
cd backend
docker-compose up -d
# Esto lanza postgres, redis, app y gatekeeper (3000)

cd frontend
npm start
# Frontend en http://localhost:4200 apuntando a http://localhost:3000
```

## 🔎 Cómo evidenciar Gatekeeper desde el Front
Usaremos DevTools (Network) y el endpoint `/api/gatekeeperz` para verificar los controles.

### 1) Ver estado
- Navegador → abrir `http://localhost:4200/api/gatekeeperz`
- Deberías ver un JSON como:
```json
{
  "passed": 10,
  "blocked": 0,
  "target": "http://app:3000",
  "cors_allowed": ["http://localhost:4200"]
}
```

### 2) Comprobar que las solicitudes válidas pasan
- Ir a página Libros (la UI dispara `GET /api/libros`).
- Abrir DevTools → pestaña Network, seleccionar la request `GET /api/libros`.
- Comprobar que responde 200 y que en `gatekeeperz.passed` el contador sube.

### 3) Ver rate limiting (429)
- En DevTools → pestaña Console, ejecutar un pequeño bombardeo:
```js
Promise.all(Array.from({length:120}).map(() => fetch('/api/libros'))).then(()=>console.log('done'))
```
- Algunas respuestas deberían ser `429 Too Many Requests`.
- Revisar `http://localhost:4200/api/gatekeeperz` → `blocked` aumenta.

### 4) Límite de tamaño de payload (413)
- En Console:
```js
const big = 'x'.repeat(300*1024);
fetch('/api/libros', {
  method: 'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ titulo: big, autor: 'Overflow' })
}).then(r=>console.log(r.status)) // 413
```
- `blocked` aumenta en `/api/gatekeeperz`.

### 5) Header no permitido (400)
- En el navegador no puedes setear headers arbitrarios de origen por CORS; para evidenciar, usa un plugin de web proxy o desde DevTools `fetch` con `mode:'no-cors'` no expondrá el 400.
- Alternativa visible: inspecciona logs del gatekeeper (Docker):
```bash
cd backend
docker-compose logs -f gatekeeper
```
- Verás eventos rechazados con `header not allowed` si un cliente externo envía headers fuera de allowlist.

### 6) Ruta o método no permitido (405)
- En Console:
```js
fetch('/api/libros', { method:'DELETE' }).then(r=>console.log(r.status)) // 405
```
- `/api/gatekeeperz` → `blocked` aumenta.

### 7) CORS estricto
- Intentar abrir la app desde otro origen (p.ej. un archivo HTML local con `fetch('http://localhost:3000/api/libros')`).
- La solicitud se bloquea por CORS si el origen no está en la allowlist.

## 📌 Señales visibles del patrón
- `GET /api/gatekeeperz` muestra contadores `passed` (permitidas) y `blocked` (bloqueadas).
- DevTools → Network evidencia respuestas 429, 413, 405, 400 según el control activado.
- Logs del gatekeeper (`docker-compose logs -f gatekeeper`) muestran cada request con `X-Request-Id`.

## 🧪 Guion de demo (3-5 min)
1. Mostrar `/api/gatekeeperz` (contadores en cero o bajos).
2. Navegar a Libros, ver `GET /api/libros` → `passed` sube.
3. Bombardear con 120 GET → observar `429` y `blocked` subir.
4. Probar POST con payload enorme → `413` y `blocked` sube.
5. Probar `DELETE /api/libros` → `405`.

## 🧰 Troubleshooting
- Si `readyz` del gatekeeper da 503, revisa que la API esté healthy (`/api/readyz`).
- Si todo se bloquea, revisa allowlist de rutas/métodos en `gatekeeper/server.js`.
- Si la UI no carga, verifica CORS y el proxy del frontend (apunta a 3000).

## ✅ Checklist de evidencias Gatekeeper
- [ ] `/api/gatekeeperz` accesible y aumenta contadores
- [ ] `GET /api/libros` pasa (200) – `passed` sube
- [ ] Rate limit provoca 429 – `blocked` sube
- [ ] Payload grande recibe 413 – `blocked` sube
- [ ] `DELETE /api/libros` recibe 405 – `blocked` sube
