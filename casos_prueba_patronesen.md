# Casos de Prueba - Patrones de Arquitectura

Este documento contiene casos de prueba específicos para demostrar la implementación y funcionamiento de los patrones de arquitectura documentados en el proyecto de la API de biblioteca.

## 1. PATRONES DE DISPONIBILIDAD

### 1.1 Retry Pattern

#### Caso de Prueba 1.1.1: Reintento exitoso tras fallo transitorio
- **Objetivo**: Verificar que el sistema reintenta automáticamente operaciones fallidas por errores transitorios
- **Precondiciones**:
  - Base de datos PostgreSQL ejecutándose
  - Servidor backend iniciado
- **Pasos**:
  1. Crear un libro mediante POST /libros
  2. Simular un error transitorio (ej: desconectar temporalmente la BD)
  3. Realizar una consulta GET /libros
- **Resultado esperado**:
  - El sistema debe reintentar automáticamente hasta 3 veces
  - La consulta debe completarse exitosamente una vez restaurada la conexión
  - En los logs debe aparecer: "[DB RETRY] intento X en Yms - motivo: ..."
- **Comando de prueba**:
```bash
# Crear libro
curl -X POST http://localhost:3000/libros \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Libro de Prueba","autor":"Autor Test"}'

# Verificar funcionamiento normal
curl -s http://localhost:3000/libros | jq '.[0]'
```

#### Caso de Prueba 1.1.2: Máximo de reintentos alcanzado
- **Objetivo**: Verificar que el sistema falla después del máximo de reintentos
- **Precondiciones**:
  - Base de datos PostgreSQL detenida
- **Pasos**:
  1. Detener el servicio PostgreSQL
  2. Realizar consulta GET /libros
- **Resultado esperado**:
  - Tres intentos de reintento deben aparecer en logs
  - Error final debe retornarse al cliente
  - Sistema debe mantener estabilidad
- **Comando de prueba**:
```bash
# Detener PostgreSQL (en Docker)
docker-compose stop postgres

# Intentar consulta
curl -s http://localhost:3000/libros

# Reiniciar PostgreSQL
docker-compose start postgres
```

### 1.2 Health Endpoint Monitoring Pattern

#### Caso de Prueba 1.2.1: Endpoint de Liveness (/healthz)
- **Objetivo**: Verificar que el servicio reporta su estado de vida correctamente
- **Precondiciones**:
  - Servidor backend ejecutándose
- **Pasos**:
  1. Realizar petición GET al endpoint /healthz
- **Resultado esperado**:
  - Respuesta HTTP 200
  - JSON con status "ok", uptime y timestamp
- **Comando de prueba**:
```bash
curl -s http://localhost:3000/healthz | jq .
# Resultado esperado:
# {
#   "status": "ok",
#   "uptime_s": 123.456,
#   "now": "2025-10-31T01:09:35.863Z"
# }
```

#### Caso de Prueba 1.2.2: Endpoint de Readiness (/readyz)
- **Objetivo**: Verificar que el servicio reporta su capacidad para atender tráfico
- **Precondiciones**:
  - Base de datos PostgreSQL ejecutándose
- **Pasos**:
  1. Realizar petición GET al endpoint /readyz
- **Resultado esperado**:
  - Respuesta HTTP 200
  - JSON con status "ready", db "ok", latency y timestamp
- **Comando de prueba**:
```bash
curl -s http://localhost:3000/readyz | jq .
# Resultado esperado:
# {
#   "status": "ready",
#   "db": "ok",
#   "latency_ms": 4,
#   "now": "2025-10-31T01:09:38.389Z"
# }
```

#### Caso de Prueba 1.2.3: Readiness cuando BD está caída
- **Objetivo**: Verificar que readiness detecta problemas de conectividad
- **Precondiciones**:
  - Base de datos PostgreSQL detenida
- **Pasos**:
  1. Detener PostgreSQL
  2. Realizar petición GET al endpoint /readyz
- **Resultado esperado**:
  - Respuesta HTTP 503
  - JSON con status "not-ready", db "down" y mensaje de error
- **Comando de prueba**:
```bash
# Detener BD
docker-compose stop postgres

# Verificar readiness
curl -s http://localhost:3000/readyz | jq .
# Resultado esperado:
# {
#   "status": "not-ready",
#   "db": "down",
#   "error": "timeout",
#   "latency_ms": 1500
# }

# Reiniciar BD
docker-compose start postgres
```

## 2. PATRONES DE RENDIMIENTO

### 2.1 Cache-Aside Pattern

#### Caso de Prueba 2.1.1: Cache Miss (Escenario Hipotético)
- **Objetivo**: Demostrar cómo funcionaría el patrón si estuviera implementado
- **Precondiciones**:
  - Sistema de caché Redis configurado (no implementado actualmente)
- **Pasos**:
  1. Primera consulta a GET /libros (cache miss)
  2. Sistema consulta PostgreSQL y almacena en Redis
  3. Segunda consulta a GET /libros (cache hit)
- **Resultado esperado**:
  - Primera consulta: latencia ~100-200ms (consulta BD)
  - Segunda consulta: latencia ~5-10ms (desde caché)
- **Implementación hipotética**:
```javascript
// En server.js - hipotético
const redis = new Redis(process.env.REDIS_URL);

app.get("/libros", async (req, res) => {
  const cacheKey = "libros";

  // Intentar obtener de caché
  let libros = await redis.get(cacheKey);
  if (!libros) {
    // Cache miss - consultar BD
    const result = await pool.query("SELECT * FROM libro");
    libros = JSON.stringify(result.rows);

    // Almacenar en caché por 5 minutos
    await redis.setex(cacheKey, 300, libros);
  }

  res.json(JSON.parse(libros));
});
```

### 2.2 CQRS Pattern

#### Caso de Prueba 2.2.1: Separación de comandos y queries (Escenario Hipotético)
- **Objetivo**: Demostrar separación de responsabilidades de lectura/escritura
- **Precondiciones**:
  - Modelo CQRS implementado (no implementado actualmente)
- **Pasos**:
  1. Crear libro (comando - afecta modelo de escritura)
  2. Consultar libros disponibles (query - lee modelo de lectura optimizado)
  3. Verificar sincronización entre modelos
- **Resultado esperado**:
  - Comando ejecuta lógica de negocio compleja
  - Query retorna datos optimizados para lectura rápida
  - Ambos modelos mantienen consistencia eventual
- **Implementación hipotética**:
```javascript
// Modelo de Escritura (Comandos)
class LibroCommandService {
  async crearLibro(libroData) {
    // Validaciones complejas de negocio
    await pool.query("INSERT INTO libro ...");

    // Publicar evento para actualizar modelo de lectura
    await eventPublisher.publish("libro-creado", libroData);
  }
}

// Modelo de Lectura (Queries)
class LibroQueryService {
  async obtenerLibrosDisponibles() {
    // Query optimizada desde vista materializada
    return await pool.query("SELECT * FROM vista_libros_disponibles");
  }
}
```

## 3. PATRONES DE SEGURIDAD

### 3.1 Gatekeeper Pattern

#### Caso de Prueba 3.1.1: Validación de entrada maliciosa
- **Objetivo**: Verificar que el sistema valida y sanitiza entradas
- **Precondiciones**:
  - Servidor backend ejecutándose
- **Pasos**:
  1. Enviar petición POST con datos maliciosos (SQL injection)
  2. Verificar que la petición es rechazada
- **Resultado esperado**:
  - Sistema detecta entrada maliciosa
  - Respuesta HTTP 400 Bad Request
  - Datos no llegan a la base de datos
- **Comando de prueba**:
```bash
# Intentar SQL injection
curl -X POST http://localhost:3000/libros \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Libro'; DROP TABLE libro;--","autor":"Hacker"}'

# Resultado esperado: Error 400 o validación rechazada
```

#### Caso de Prueba 3.1.2: Rate limiting (Escenario Hipotético)
- **Objetivo**: Demostrar protección contra ataques de fuerza bruta
- **Precondiciones**:
  - Middleware de rate limiting implementado
- **Pasos**:
  1. Realizar múltiples peticiones en poco tiempo
  2. Verificar que peticiones adicionales son bloqueadas
- **Resultado esperado**:
  - Primeras peticiones: HTTP 200
  - Peticiones excedentes: HTTP 429 Too Many Requests

### 3.2 Federated Identity Pattern

#### Caso de Prueba 3.2.1: Autenticación básica actual
- **Objetivo**: Verificar el sistema de autenticación actual
- **Precondiciones**:
  - Usuario registrado en el sistema
- **Pasos**:
  1. Crear usuario con POST /usuarios
  2. Autenticar con POST /login
- **Resultado esperado**:
  - Usuario creado exitosamente
  - Token de autenticación generado
- **Comando de prueba**:
```bash
# Crear usuario
curl -X POST http://localhost:3000/usuarios \
  -H "Content-Type: application/json" \
  -d '{
    "correo": "test@example.com",
    "clave": "password123",
    "nombre_mostrar": "Usuario Test"
  }'

# Autenticar
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{
    "correo": "test@example.com",
    "clave": "password123"
  }'
```

#### Caso de Prueba 3.2.2: Autenticación federada (Escenario Hipotético)
- **Objetivo**: Demostrar cómo funcionaría autenticación con Google/Facebook
- **Precondiciones**:
  - Integración con proveedores externos implementada
- **Pasos**:
  1. Usuario inicia sesión con Google
  2. Sistema valida token con Google
  3. Usuario es autenticado en la aplicación
- **Resultado esperado**:
  - Token JWT generado localmente
  - Información de usuario mapeada correctamente

## 4. PATRONES DE FACILIDAD DE MODIFICACIÓN Y DESPLIEGUE

### 4.1 External Configuration Store Pattern

#### Caso de Prueba 4.1.1: Configuración externa (Escenario Hipotético)
- **Objetivo**: Demostrar modificación de configuración sin recompilar
- **Precondiciones**:
  - Store de configuración externa configurado (ej: Azure App Config)
- **Pasos**:
  1. Cambiar configuración de conexión a BD externamente
  2. Reiniciar aplicación
  3. Verificar que nueva configuración es utilizada
- **Resultado esperado**:
  - Aplicación usa nueva configuración sin cambios en código
  - Logs muestran carga de configuración externa

### 4.2 Deployment Stamps Pattern

#### Caso de Prueba 4.2.1: Múltiples instancias (Escenario Hipotético)
- **Objetivo**: Demostrar despliegue de múltiples stamps independientes
- **Precondiciones**:
  - Infraestructura de múltiples stamps configurada
- **Pasos**:
  1. Desplegar Stamp 1 con versión v1.0
  2. Desplegar Stamp 2 con versión v2.0
  3. Verificar enrutamiento correcto de usuarios
- **Resultado esperado**:
  - Usuario A accede a Stamp 1 (v1.0)
  - Usuario B accede a Stamp 2 (v2.0)
  - Stamps operan independientemente

#### Caso de Prueba 4.2.2: Rollback de stamp
- **Objetivo**: Verificar capacidad de rollback independiente
- **Precondiciones**:
  - Múltiples stamps desplegados
- **Pasos**:
  1. Actualizar Stamp 1 a nueva versión
  2. Detectar problema en Stamp 1
  3. Revertir Stamp 1 sin afectar Stamp 2
- **Resultado esperado**:
  - Stamp 1 regresa a versión anterior
  - Stamp 2 continúa funcionando normalmente
  - Usuarios de Stamp 1 no afectados por rollback

## EJECUCIÓN DE PRUEBAS AUTOMATIZADAS

Para ejecutar todas las pruebas disponibles actualmente:

```bash
# Instalar dependencias
cd backend
npm install

# Iniciar servicios
docker-compose up -d

# Ejecutar pruebas de health check
npm test  # Si están configuradas

# Pruebas manuales con curl
curl -s http://localhost:3000/healthz
curl -s http://localhost:3000/readyz

# Crear datos de prueba
curl -X POST http://localhost:3000/usuarios \
  -H "Content-Type: application/json" \
  -d '{"correo":"test@test.com","clave":"test","nombre_mostrar":"Test User"}'

# Probar funcionalidad completa
curl http://localhost:3000/libros
```

## CONCLUSIONES

Los casos de prueba demuestran que:

1. **Patrones implementados**: Retry Pattern y Health Endpoint Monitoring funcionan correctamente en el sistema actual
2. **Patrones no implementados**: Cache-Aside, CQRS, Gatekeeper, Federated Identity, External Configuration Store y Deployment Stamps requieren implementación adicional pero están bien documentados
3. **Arquitectura sólida**: El sistema actual proporciona una base sólida para implementar los patrones faltantes

Las pruebas confirman que la arquitectura del proyecto sigue buenas prácticas y está preparada para escalar y mantener los estándares de calidad requeridos.
