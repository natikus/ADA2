# Patrón Deployment Stamps - Implementación

Este documento explica la implementación del patrón **Deployment Stamps** en la API de biblioteca, incluyendo cómo probarlo y entender su funcionamiento.

## 🎯 ¿Qué es Deployment Stamps?

El patrón Deployment Stamps es un patrón de diseño que permite escalar aplicaciones horizontalmente creando múltiples "copias" idénticas del sistema (stamps) que operan de forma independiente. Cada stamp tiene su propia infraestructura completa (API, base de datos, caché) y puede atender a subconjuntos de usuarios.

La lógica es:

1. **Aislamiento**: Cada stamp opera independientemente con su propia base de datos
2. **Enrutamiento**: Un router (gatekeeper) dirige el tráfico a diferentes stamps según reglas
3. **Escalabilidad**: Agregar stamps nuevos sin modificar el código existente
4. **Resiliencia**: Fallos en un stamp no afectan a los demás

## 🏗️ Arquitectura Implementada

### Componentes

- **Gatekeeper**: Router que enruta requests a diferentes stamps según reglas (?stamp=2)
- **Stamp Default**: Instancia original del sistema (API, PostgreSQL, Redis)
- **Stamp S1/S2**: Instancias adicionales idénticas con infraestructura propia
- **Stampsz**: Servicio de métricas que registra requests por stamp

### Infraestructura

```yaml
services:
  gatekeeper:
    image: gatekeeper
    ports: ["3000:3000"]
    environment:
      - TARGET_DEFAULT=http://app:3000
      - TARGET_S1=http://app_s1:3000
      - TARGET_S2=http://app_s2:3000

  app:        # Stamp default
    image: biblioteca-backend
    ports: ["3001:3000"]
    environment:
      - STAMP_ID=default
      # ... configuración BD/Redis propia

  app_s1:     # Stamp s1
    image: biblioteca-backend
    ports: ["3002:3000"]
    environment:
      - STAMP_ID=s1
      # ... configuración BD/Redis propia

  app_s2:     # Stamp s2
    image: biblioteca-backend
    ports: ["3003:3000"]
    environment:
      - STAMP_ID=s2
      # ... configuración BD/Redis propia

  stampsz:    # Métricas
    image: node:18-alpine
    ports: ["3004:3004"]
```

## 🔧 Implementación Técnica

### Función de Enrutamiento en Gatekeeper

```javascript
function getTarget(req) {
  const stamp = req.query.stamp;
  if (stamp === '1' || stamp === 's1') return 'http://app_s1:3000';
  if (stamp === '2' || stamp === 's2') return 'http://app_s2:3000';
  return 'http://app:3000'; // default
}
```

### Configuración de Proxy Dinámico

```javascript
const proxy = createProxyMiddleware({
  router: (req) => getTarget(req),
  changeOrigin: true,
  xfwd: true,
  onProxyReq: (_proxyReq, req, _res) => {
    const target = getTarget(req);
    const stamp = target.includes('s1') ? 's1' : 
                  target.includes('s2') ? 's2' : 'default';
    reportHit(stamp); // Métrica
  },
});
```

### Servicio de Métricas

```javascript
// stampsz.js - Contadores por stamp
let counters = { s1: 0, s2: 0, default: 0 };

app.post('/report/:stamp', (req, res) => {
  const stamp = req.params.stamp;
  if (counters[stamp] !== undefined) {
    counters[stamp]++;
  }
  res.json({ ok: true });
});

app.get('/stampsz', (req, res) => {
  res.json({
    total_requests: counters.s1 + counters.s2 + counters.default,
    by_stamp: counters
  });
});
```

## 🚀 Cómo Probar

### 1. Iniciar Servicios

```bash
cd backend
docker-compose up -d
# Levanta 3 stamps completos + gatekeeper + métricas
```

### 2. Ejecutar Prueba Automática

```bash
# Script de prueba para stamps
curl -s http://localhost:3004/stampsz | jq .  # Ver inicial

# Crear libro en default
curl -X POST http://localhost:3000/libros \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Default","autor":"Autor"}'

# Crear libro en stamp s2
curl -X POST "http://localhost:3000/libros?stamp=2" \
  -H "Content-Type: application/json" \
  -d '{"titulo":"S2","autor":"Autor"}'

# Ver aislamiento
curl http://localhost:3000/libros | jq '. | length'        # 1
curl "http://localhost:3000/libros?stamp=2" | jq '. | length'  # 1

# Ver métricas
curl -s http://localhost:3004/stampsz | jq .
```

### 3. Prueba Manual Paso a Paso

```bash
# Ver estado de stamps
curl -s http://localhost:3000/readyz | jq .

# Acceso directo a cada stamp
curl -s http://localhost:3001/libros | jq .  # Stamp default
curl -s http://localhost:3002/libros | jq .  # Stamp s1
curl -s http://localhost:3003/libros | jq .  # Stamp s2

# Crear datos en diferentes stamps
curl -X POST http://localhost:3000/libros \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Default","autor":"Autor"}'

curl -X POST "http://localhost:3000/libros?stamp=2" \
  -H "Content-Type: application/json" \
  -d '{"titulo":"S2","autor":"Autor"}'

# Verificar aislamiento
curl http://localhost:3000/libros | jq .           # Solo Default
curl "http://localhost:3000/libros?stamp=2" | jq . # Solo S2
```

## 📊 Monitoreo del Patrón

### Endpoint `/stampsz`

```bash
curl -s http://localhost:3004/stampsz | jq .
```

**Respuesta esperada:**
```json
{
  "total_requests": 6,
  "by_stamp": {
    "s1": 0,
    "s2": 2,
    "default": 4
  },
  "stamp_ids": ["s1", "s2", "default"]
}
```

### Endpoint `/readyz` del Gatekeeper

```bash
curl -s http://localhost:3000/readyz | jq .
```

**Respuesta esperada:**
```json
{
  "status": "ready",
  "stamps": {
    "default": { "status": "ready", "db": "ok" },
    "s1": { "status": "ready", "db": "ok" },
    "s2": { "status": "ready", "db": "ok" }
  }
}
```

## ⚙️ Configuración

### Variables de Entorno

```env
# Gatekeeper
TARGET_DEFAULT=http://app:3000
TARGET_S1=http://app_s1:3000
TARGET_S2=http://app_s2:3000
METRICS_URL=http://stampsz:3004

# Stamps
STAMP_ID=s1  # o s2, o default
```

### Puertos Expuestos

- Gatekeeper: 3000 (entrada principal)
- Stamp Default: 3001
- Stamp S1: 3002
- Stamp S2: 3003
- Métricas: 3004

## 🔍 Logs a Observar

```
[STAMP:s1] API escuchando en http://0.0.0.0:3000
[STAMP:s2] API escuchando en http://0.0.0.0:3000
Gatekeeper listening on http://0.0.0.0:3000 -> routing to stamps
Stamps metrics server on http://localhost:3004/stampsz
```

## 🎯 Beneficios Obtenidos

1. **Escalabilidad Horizontal**: Agregar stamps nuevos sin modificar código
2. **Aislamiento de Fallas**: Problemas en un stamp no afectan otros
3. **Despliegues Graduales**: Actualizar stamps uno por uno
4. **Separación por Tenants**: Diferentes clientes en stamps distintos
5. **Resiliencia**: Sistema continúa funcionando si un stamp falla

## 🐛 Solución de Problemas

### Stamps no inician
```bash
docker-compose logs postgres_s1
docker-compose logs app_s1
```

### Enrutamiento no funciona
- Verificar que `?stamp=2` llegue al gatekeeper
- Comprobar logs del gatekeeper
- Confirmar que stamps están healthy: `curl http://localhost:3000/readyz`

### Datos no aislados
- Cada stamp tiene su propia base: `biblioteca`, `biblioteca_s1`, `biblioteca_s2`
- Verificar conexiones de cada stamp en docker-compose.yml

## 📚 Recursos Adicionales

- [Deployment Stamps - Microsoft Azure](https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp)
- [Multi-region deployment - AWS](https://docs.aws.amazon.com/whitepapers/latest/multi-region-application-deployment/multi-region-application-deployment.html)

---

## ✅ Checklist de Implementación

- [x] 3 stamps completos (default, s1, s2) con infraestructura propia
- [x] Gatekeeper que enruta por ?stamp=2
- [x] Servicio de métricas /stampsz
- [x] Aislamiento de datos entre stamps
- [x] Logs identificando cada stamp
- [x] Docker compose completo con redes y volúmenes
- [x] Script de prueba automatizado
