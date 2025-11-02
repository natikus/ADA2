# External Configuration Store (JSON + Hot Reload) - Guía de demostración

Esta guía muestra cómo evidenciar el patrón **External Configuration Store** en la API, usando un archivo `config.json` centralizado, validación por esquema y recarga en caliente (sin reiniciar la app).

## 🎯 Objetivo
- Mover parámetros operativos a un store externo (archivo JSON montado por Docker).
- Validar la configuración (schema Ajv) y recargarla automáticamente cuando cambia.
- Demostrar un efecto visible: los TTL de cache (cache-aside) se actualizan en vivo.

## 🏗️ Estructura
- backend/config/config.json (valores activos)
- backend/config/config.schema.json (validación Ajv)
- backend/config/config.service.js (carga, validación, hot-reload)
- Endpoint de observabilidad: `GET /configz`

Valores de ejemplo (config.json):
```json
{
  "cache": {
    "ttlAll": 300,
    "ttlSearch": 180
  },
  "features": {
    "demoMode": true
  }
}
```

## ▶️ Puesta en marcha
```bash
cd backend
docker-compose up -d
# El volumen ./config se monta como /app/config (lectura) en el contenedor de la API
```

## 🔎 Cómo evidenciar el patrón
1) Ver configuración activa
```bash
curl -s http://localhost:3001/configz | jq .
# {
#   "updated_at": "2025-11-01T20:xx:xx.xxxZ",
#   "config": { "cache": { "ttlAll": 300, "ttlSearch": 180 }, ... }
# }
```

2) Ver TTL aplicado en caché (cache-aside)
```bash
# Forzar un cache miss y guardar en Redis
curl -s http://localhost:3001/libros > /dev/null
# Ver claves en cache
curl -s http://localhost:3001/cachez | jq .
# Mostrar "libros:all" con un ttl cercano a 300 (ttlAll)
```

3) Editar configuración en vivo (sin reiniciar)
- Abrir `backend/config/config.json` y cambiar valores, por ejemplo:
```json
{
  "cache": {
    "ttlAll": 20,
    "ttlSearch": 10
  },
  "features": { "demoMode": true }
}
```
- Guardar el archivo. El backend recarga en caliente (log: `[CONFIG] recargada ...`).
- Comprobar:
```bash
curl -s http://localhost:3001/configz | jq .  # updated_at cambia y muestra nuevos TTL
```

4) Ver nuevo TTL aplicado
```bash
# Invalida o espera expiración; luego vuelve a consultar para generar un nuevo cache miss
curl -s http://localhost:3001/libros > /dev/null
curl -s http://localhost:3001/cachez | jq .
# El ttl de "libros:all" ahora cercano a 20
```

## 🔐 Validación por esquema
- `config.schema.json` define estructura y rangos (por ejemplo, ttl en [10, 86400]).
- Si el archivo no pasa la validación, se conserva la última config válida y se loguea un error.

## 📌 Señales visibles del patrón
- `GET /configz`: muestra la configuración activa y `updated_at` (cambia en caliente).
- Efecto operacional: TTL de caché cambia sin reiniciar la app.
- Logs: `[CONFIG] recargada <timestamp>` al guardar `config.json`.

## 🧪 Guion de demo (3-5 min)
1. Mostrar `GET /configz` con ttlAll=300.
2. Generar caché y mostrar `ttl ~300` en `/cachez`.
3. Editar `config.json` → ttlAll=20 → guardar → logs `[CONFIG] recargada`.
4. Nuevo cache miss → mostrar `ttl ~20` en `/cachez`.

## 🧰 Troubleshooting
- No recarga: verificar que el volumen `./config:/app/config:ro` esté montado (docker-compose ps/logs).
- JSON inválido: revisar logs, corregir el archivo según `config.schema.json`.
- Cambios no se reflejan en caché activo: recuerda que el nuevo TTL aplica en el próximo cache miss.

## ✅ Checklist de evidencias
- [ ] `/configz` accesible y muestra `updated_at`.
- [ ] Guardar `config.json` provoca `[CONFIG] recargada` en logs.
- [ ] TTL de caché cambia tras nuevo cache miss según el valor configurado.
