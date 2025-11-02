# Federated Identity (Google OIDC) - Guía de demostración (Frontend)

Esta guía muestra cómo evidenciar la autenticación federada con **Google OIDC** en la app:
- El Front obtiene un `id_token` de Google (GIS).
- El Backend verifica el `id_token`, crea/recupera al usuario local y emite un **JWT propio** (1h).
- La UI usa ese JWT como `Authorization: Bearer` y puede consultar `/whoami`.

## 🎯 Objetivo
- Demostrar login federado con Google manteniendo la API actual.
- Evidenciar la separación: Google valida identidad; la API emite y usa su propio JWT.

## 🔑 Requisitos
- Un **Google OAuth Client ID** de tipo Web.
  - Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID.
  - Authorized JavaScript origins: `http://localhost:4200`.
  - Copia el Client ID (termina en `.apps.googleusercontent.com`).

## ⚙️ Configuración
1) Backend (variables de entorno)
```
GOOGLE_CLIENT_ID=tu_client_id.apps.googleusercontent.com
JWT_SECRET=alguna_clave_segura
```
- Estos valores deben estar disponibles en el contenedor `app` (por env o .env).

2) Frontend (botón de Google)
- Reemplaza el placeholder en `frontend/src/app/pages/login/login.component.html`:
```html
<div id="g_id_onload"
     data-client_id="tu_client_id.apps.googleusercontent.com"
     data-context="signin"
     data-callback="handleGoogleCredential"
     data-auto_prompt="false">
</div>
```

## ▶️ Puesta en marcha
```bash
# Backend + Gatekeeper
cd backend
docker-compose up -d

# Frontend
cd ../frontend
npm start   # http://localhost:4200 (proxy a http://localhost:3000)
```

## 🔎 Flujo de demo (UI/Browser)
1. Ir a `/login` y pulsar “Sign in with Google”.
2. Completar el flujo de Google: al finalizar, el Front envía `id_token` a `POST /api/auth/google/callback`.
3. La API verifica el token, **crea/recupera el usuario local** y responde con un **JWT propio**.
4. La UI guarda el JWT en `localStorage` (clave `api_jwt`).
5. Pulsar “¿Quién soy?” → hace `GET /api/whoami` con `Authorization: Bearer <JWT>` y devuelve las claims.

Evidencias visibles
- DevTools → Network:
  - `POST /api/auth/google/callback` (200) con respuesta `{ token, user }`.
  - `GET /api/whoami` (200) con claims `{ sub, email, name, iat, exp }`.
- `localStorage.getItem('api_jwt')` contiene el token emitido por la API.

## 🔐 Endpoints involucrados
- `POST /auth/google/callback`: recibe `id_token`, verifica con Google, emite JWT propio.
- `GET /whoami`: requiere `Authorization: Bearer` y devuelve claims del JWT.

## 🧪 Casos de prueba rápidos
- Login exitoso: botón de Google → `/auth/google/callback` → `/whoami` OK.
- Token inválido (simulado): cambia un carácter del `id_token` en DevTools → `/auth/google/callback` → 401.
- Sin JWT: llama `/whoami` sin header → 401.

## 📊 Observabilidad sugerida
- Gatekeeper: `GET /api/gatekeeperz` → revisa `passed/blocked`.
- (Opcional) CQRS: `GET /api/cqrsz` para ver counters de queries/commands si navegas por la app.

## 🧰 Troubleshooting
- 401 en `/auth/google/callback`:
  - `GOOGLE_CLIENT_ID` no coincide con el de Front.
  - Email no verificado en Google.
- 401 en `/whoami`:
  - Falta header `Authorization: Bearer <JWT>` o `JWT_SECRET` incorrecto en backend.
- CORS bloquea el flujo:
  - Gatekeeper sólo permite `http://localhost:4200` (ajústalo si usas otro origen).

## 📸 Capturas sugeridas (para el informe)
- Pantalla de login con botón Google.
- DevTools → Network mostrando `POST /auth/google/callback` (200).
- DevTools → Application → Local Storage con `api_jwt`.
- `/whoami` en el navegador con claims.

## ✅ Checklist de la demo
- [ ] Client ID configurado en Front y Backend.
- [ ] Login federado ejecuta `POST /auth/google/callback` (200) y guarda el JWT.
- [ ] `/whoami` devuelve claims con `Authorization: Bearer`.
