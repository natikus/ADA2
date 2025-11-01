# Patrón Cache-Aside - Implementación

Este documento explica la implementación del patrón **Cache-Aside** en la API de biblioteca, incluyendo cómo probarlo y entender su funcionamiento.

## 🎯 ¿Qué es Cache-Aside?

El patrón Cache-Aside es un patrón de diseño que mejora el rendimiento de aplicaciones al almacenar datos frecuentemente consultados en una caché. La lógica es:

1. **Cache Hit**: Si los datos están en caché, se devuelven desde ahí
2. **Cache Miss**: Si no están en caché, se consultan desde la base de datos y se almacenan en caché
3. **Invalidación**: Cuando los datos cambian, se elimina la entrada de caché

## 🏗️ Arquitectura Implementada

### Componentes

- **Redis**: Cache distribuida en memoria
- **PostgreSQL**: Base de datos principal
- **API Node.js**: Lógica de aplicación con patrón Cache-Aside

### Infraestructura

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  postgres:
    image: postgres:15-alpine
    # ... configuración BD

  app:
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
      - postgres
```

## 🔧 Implementación Técnica

### Función Helper `getCachedOrQuery`

```javascript
async function getCachedOrQuery(cacheKey, queryFn, ttlSeconds = 300) {
  try {
    // 1. Intentar obtener de caché
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] ${cacheKey}`);
      return JSON.parse(cached);
    }

    // 2. Cache miss - ejecutar query
    console.log(`[CACHE MISS] ${cacheKey}`);
    const result = await queryFn();

    // 3. Almacenar en caché
    await redis.setex(cacheKey, ttlSeconds, JSON.stringify(result));

    return result;
  } catch (err) {
    console.warn(`[CACHE ERROR] ${cacheKey}:`, err.message);
    // Fallback: ejecutar query sin caché
    return await queryFn();
  }
}
```

### Endpoint de Libros con Cache

```javascript
app.get("/libros", async (req, res) => {
  const { q } = req.query;

  if (q) {
    // Búsqueda con TTL más corto (3 min)
    const cacheKey = `libros:search:${q}`;
    const result = await getCachedOrQuery(cacheKey, async () => {
      const { rows } = await pool.query(/* query búsqueda */);
      return rows;
    }, 180);
    return res.json(result);
  }

  // Listado general con TTL más largo (5 min)
  const cacheKey = 'libros:all';
  const result = await getCachedOrQuery(cacheKey, async () => {
    const { rows } = await pool.query(/* query general */);
    return rows;
  }, 300);
  res.json(result);
});
```

### Invalidación de Caché

```javascript
app.post("/libros", async (req, res) => {
  // Crear libro...
  const { rows } = await pool.query(/* INSERT */);

  // Invalidar caché
  await redis.del('libros:all');
  console.log('[CACHE INVALIDATE] libros:all');

  res.status(201).json(rows[0]);
});
```

## 🚀 Cómo Probar

### 1. Iniciar Servicios

```bash
cd backend
docker-compose up -d
```

### 2. Ejecutar Script de Prueba Automático

```bash
# Desde el directorio raíz del proyecto
./test_cache_aside.sh
```

### 3. Prueba Manual Paso a Paso

```bash
# 1. Verificar estado inicial (backend en puerto 3001)
curl -s http://localhost:3001/cachez | jq .

# 2. Primera consulta (CACHE MISS)
curl -s http://localhost:3001/libros | jq '. | length'

# 3. Verificar que se cacheó
curl -s http://localhost:3001/cachez | jq .

# 4. Segunda consulta (CACHE HIT - desde Redis)
curl -s http://localhost:3001/libros | jq '. | length'

# 5. Crear libro (invalida caché)
curl -X POST http://localhost:3001/libros \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Nuevo Libro Cache","autor":"Autor Test","anio_publicacion":2024}'

# 6. Verificar invalidación (libros:all desaparece)
curl -s http://localhost:3001/cachez | jq .

# 7. Tercera consulta (CACHE MISS - carga datos actualizados)
curl -s http://localhost:3001/libros | jq '. | length'

# 8. Verificar que se vuelve a cachear
curl -s http://localhost:3001/cachez | jq .
```

### 4. Ver Logs de Cache en Tiempo Real

```bash
# Ver logs del contenedor de la aplicación
cd backend
docker-compose logs -f app
```

Deberías ver mensajes como:
```
[CACHE MISS] libros:all
[CACHE HIT] libros:all
[CACHE INVALIDATE] libros:all
```

## 📊 Monitoreo del Caché

### Headers HTTP en respuestas

Cada consulta a `/libros` incluye headers informativos sobre el estado del caché:

```bash
# Ejemplo de respuesta con headers
curl -I http://localhost:3001/libros

# Resultado:
# X-Cache-Status: HIT
# X-Cache-Key: libros:all
# X-Response-Time: 2ms
# X-Cache-TTL: 300s
# X-Query-Time: 15ms  # Solo presente en MISS
```

**Headers disponibles:**
- `X-Cache-Status`: `HIT`, `MISS`, o `ERROR`
- `X-Cache-Key`: Clave usada en Redis
- `X-Response-Time`: Tiempo total de respuesta
- `X-Cache-TTL`: Tiempo de vida en segundos
- `X-Query-Time`: Tiempo de consulta a BD (solo en MISS)

### Endpoint `/cachez`

```bash
curl -s http://localhost:3001/cachez | jq .
```

**Respuesta esperada:**
```json
{
  "redis_connected": true,
  "cache_keys": ["libros:all"],
  "cache_info": {
    "libros:all": {
      "ttl": 287,
      "size": 405,
      "has_data": true
    }
  }
}
```

### Endpoint `/cachelogs`

Para ver el historial de operaciones del caché en tiempo real:

```bash
# Ver últimos 10 logs
curl -s http://localhost:3001/cachelogs | jq .

# Ver solo logs de tipo HIT
curl -s "http://localhost:3001/cachelogs?type=HIT" | jq .

# Ver últimos 5 logs
curl -s "http://localhost:3001/cachelogs?limit=5" | jq .
```

**Respuesta esperada:**
```json
{
  "total_logs": 4,
  "logs_returned": 4,
  "filter": null,
  "logs": [
    {
      "timestamp": "2025-11-01T20:54:19.185Z",
      "type": "STORE",
      "message": "Datos guardados en caché",
      "cacheKey": "libros:all",
      "ttlSeconds": 300,
      "dataSize": 405,
      "queryTime": 13,
      "totalTime": 14
    },
    {
      "timestamp": "2025-11-01T20:54:19.172Z",
      "type": "MISS",
      "message": "Consultando base de datos",
      "cacheKey": "libros:all"
    }
  ]
}
```

**Tipos de logs disponibles:**
- `HIT`: Datos obtenidos desde caché
- `MISS`: Consultando base de datos
- `STORE`: Datos guardados en caché
- `INVALIDATE`: Caché invalidado
- `ERROR`: Error en operaciones de caché

## ⚙️ Configuración

### Variables de Entorno

```env
REDIS_URL=redis://redis:6379
```

### TTL (Time To Live)

- **Listado general**: 300 segundos (5 minutos)
- **Búsquedas**: 180 segundos (3 minutos)

## 🔍 Logs a Observar

```
[CACHE MISS] libros:all          # Primera consulta
[CACHE HIT] libros:all           # Consultas posteriores
[CACHE INVALIDATE] libros:all    # Después de crear libro
[CACHE ERROR] libros:all: ...    # Si Redis no está disponible
```

## 🎯 Beneficios Obtenidos

1. **Rendimiento**: Consultas ~10x más rápidas desde caché
2. **Escalabilidad**: Reduce carga en PostgreSQL
3. **Resiliencia**: Funciona sin caché (fallback automático)
4. **Consistencia**: Invalidación automática al modificar datos

## 🐛 Solución de Problemas

### Redis no conectado
```bash
# Verificar estado
docker-compose ps

# Ver logs
docker-compose logs redis
```

### Caché no se invalida
- Verificar logs de aplicación
- Comprobar que `redis.del()` se ejecuta correctamente

### Datos obsoletos
- Verificar TTL de las claves
- Comprobar que la invalidación se ejecuta después de modificaciones

## 📚 Recursos Adicionales

- [Patrón Cache-Aside - Microsoft Azure](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
- [Redis Documentation](https://redis.io/documentation)
- [ioredis - Cliente Redis para Node.js](https://github.com/luin/ioredis)

---

## ✅ Checklist de Implementación

- [x] Redis agregado a docker-compose.yml
- [x] Cliente Redis importado en server.js
- [x] Función helper `getCachedOrQuery` implementada
- [x] Endpoint GET /libros usa caché
- [x] Invalidación de caché al crear libros
- [x] Endpoint /cachez para monitoreo
- [x] Script de prueba automatizado
- [x] Logs informativos
- [x] Manejo de errores con fallback
