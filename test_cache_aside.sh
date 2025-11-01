#!/bin/bash

echo "=== PRUEBA DEL PATRÓN CACHE-ASIDE ==="
echo ""

# Función para esperar
wait_seconds() {
    echo "Esperando $1 segundos..."
    sleep $1
}

# Función para hacer petición y mostrar resultado
test_request() {
    local description="$1"
    local url="$2"
    local expected_status="${3:-200}"

    echo ""
    echo "--- $description ---"
    echo "URL: $url"

    # Reemplazar localhost:3000 con localhost:3001 para acceder al backend directamente
    url=$(echo "$url" | sed 's/localhost:3000/localhost:3001/g')

    response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$url")
    http_status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)
    body=$(echo "$response" | sed '$d')

    if [ "$http_status" = "$expected_status" ]; then
        echo "✅ Status: $http_status (OK)"
    else
        echo "❌ Status: $http_status (Expected: $expected_status)"
    fi

    # Mostrar body si es pequeño
    if [ ${#body} -lt 500 ]; then
        echo "Body: $body"
    else
        echo "Body: (respuesta grande - $(( ${#body} / 1024 )) KB)"
    fi
}

echo "1. Verificando estado inicial del sistema..."
test_request "Health Check" "http://localhost:3000/healthz"
test_request "Readiness Check" "http://localhost:3000/readyz"
test_request "Cache Status" "http://localhost:3000/cachez"

echo ""
echo "2. Primera consulta a libros (debería ser CACHE MISS)..."
test_request "GET /libros (primera vez)" "http://localhost:3000/libros"

echo ""
echo "3. Verificando que se almacenó en caché..."
test_request "Cache Status después de consulta" "http://localhost:3000/cachez"

echo ""
echo "4. Segunda consulta a libros (debería ser CACHE HIT)..."
test_request "GET /libros (segunda vez)" "http://localhost:3000/libros"

echo ""
echo "5. Creando un nuevo libro (debería invalidar caché)..."
test_request "POST /libros (crear libro)" "http://localhost:3000/libros" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{
        "titulo": "Libro de Prueba Cache-Aside",
        "autor": "Autor Test",
        "anio_publicacion": 2024
    }'

echo ""
echo "6. Verificando invalidación de caché..."
test_request "Cache Status después de crear libro" "http://localhost:3000/cachez"

echo ""
echo "7. Tercera consulta a libros (debería ser CACHE MISS nuevamente)..."
test_request "GET /libros (después de crear)" "http://localhost:3000/libros"

echo ""
echo "8. Probando búsqueda con parámetro..."
test_request "GET /libros?q=orwell" "http://localhost:3000/libros?q=orwell"

echo ""
echo "9. Verificando caché de búsqueda..."
test_request "Cache Status final" "http://localhost:3000/cachez"

echo ""
echo "10. Verificando headers HTTP..."
echo "--- Headers de la última respuesta ---"
curl -s -I http://localhost:3000/libros | grep -E "(X-Cache|X-Response)"

echo ""
echo "11. Verificando logs del caché..."
test_request "Logs del caché" "http://localhost:3000/cachelogs"

echo ""
echo "=== PRUEBA COMPLETADA ==="
echo ""
echo "Resumen de lo que debería suceder:"
echo "1. Primera consulta: CACHE MISS (consulta BD) - Headers: X-Cache-Status: MISS"
echo "2. Se almacena en Redis con TTL"
echo "3. Segunda consulta: CACHE HIT (desde Redis) - Headers: X-Cache-Status: HIT"
echo "4. Crear libro invalida caché - Logs muestran INVALIDATE"
echo "5. Tercera consulta: CACHE MISS (consulta BD actualizada)"
echo "6. Búsqueda también se cachea con TTL más corto"
echo "7. Headers HTTP muestran estado del caché en cada respuesta"
echo "8. Logs del caché disponibles en /cachelogs"
echo ""
echo "Para ejecutar nuevamente: ./test_cache_aside.sh"
