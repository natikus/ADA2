# Patrón CQRS - Guía de demostración desde el Front

Este documento explica cómo evidenciar la implementación del patrón **CQRS** usando la UI Angular del proyecto y el navegador (sin usar herramientas externas), de forma que sea claro qué operaciones pasan por el **Command Bus** (escrituras) y cuáles por el **Query Bus** (lecturas).

## 🎯 Objetivo

- Mantener las mismas URLs REST (no cambiaron los endpoints)
- Mostrar, desde el Front, la separación de responsabilidades:
  - Lecturas (GET) → Query Bus
  - Escrituras (POST) → Command Bus
- Evidenciar el patrón con métricas y señales visibles (endpoint `/cqrsz`, métodos HTTP, flujos en UI)

## 🏗️ Qué se migró a CQRS

- Libros: POST `/libros` (Command), GET `/libros` (Query)
- Usuarios: POST `/usuarios` (Command), GET `/usuarios` (Query)
- Copias: POST `/copias` (Command), GET `/copias` (Query)
- Solicitudes: POST `/solicitudes`, POST `/solicitudes/:id/aceptar`, POST `/solicitudes/:id/rechazar` (Commands) / GET `/solicitudes` (Query)
- Préstamos: POST `/prestamos/:id/devolver` (Command) / GET `/prestamos` (Query)

Además, existe el endpoint de observabilidad:
- `/cqrsz`: muestra contadores de comandos y queries ejecutados

## ▶️ Puesta en marcha

1) Backend
```bash
cd backend
docker-compose up -d
```

2) Frontend
- Asegúrate que el proxy apunte al backend en 3001 (ya configurado): `frontend/proxy.conf.json`
```json
[
  {
    "context": ["/api"],
    "target": "http://localhost:3001",
    "secure": false,
    "changeOrigin": true,
    "pathRewrite": { "^/api": "" },
    "logLevel": "debug"
  }
]
```
- Ejecutar Angular
```bash
cd frontend
npm install
npm start  # o ng serve --proxy-config proxy.conf.json
```
- Abrir `http://localhost:4200`

## 🔎 Cómo evidenciar CQRS desde la UI/Browser

Usaremos páginas ya existentes y el navegador (DevTools → Network) + el endpoint `/api/cqrsz` para ver contadores.

### A) Libros (Query → GET, Command → POST)

1. Abrir la página de Libros (ya carga el listado automáticamente)
2. Abrir DevTools (F12) → pestaña Network
3. Ver la solicitud GET `GET /api/libros` (esto es Query Bus)
4. En otra pestaña del navegador visitar `http://localhost:4200/api/cqrsz` y observar el JSON:
```json
{
  "commands_executed": 0,
  "queries_executed": N
}
```
- El valor de `queries_executed` habrá aumentado.

5. Crear un libro desde el formulario (título/autor) → botón "Crear"
6. Ver en Network una `POST /api/libros` (esto es Command Bus)
7. Refrescar `http://localhost:4200/api/cqrsz` y comprobar:
   - `commands_executed` incrementó +1
   - `queries_executed` también aumenta porque la UI vuelve a listar al finalizar

Tip: Puedes repetir crear/listar para ver cómo cambian los contadores.

### B) Usuarios (Query + Command)

1. Ir a la sección de usuarios (si no existe, puedes probar desde la consola):
   - GET usuarios:
   ```js
   fetch('/api/usuarios').then(r=>r.json()).then(console.log)
   ```
   Observa `queries_executed` en `/api/cqrsz`.

2. Crear un usuario:
   ```js
   fetch('/api/usuarios', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ correo:'ui@test.com', clave:'123456', nombre_mostrar:'UI Test' })
   }).then(r=>r.json()).then(console.log)
   ```
   Observa `commands_executed` en `/api/cqrsz`.

### C) Copias (Query + Command)

1. Listar copias (desde la UI si está, o consola del navegador):
```js
fetch('/api/copias').then(r=>r.json()).then(console.log)
```
2. Crear una copia (requiere un `id_libro` existente):
```js
fetch('/api/copias', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id_libro: 1, id_duenio: 1, estado:'BUENO' })
}).then(r=>r.json()).then(console.log)
```
3. Consultar `/api/cqrsz` para ver los contadores subir.

### D) Solicitudes y Préstamos (Commands + Queries)

1. Listar solicitudes:
```js
fetch('/api/solicitudes').then(r=>r.json()).then(console.log)
```
2. Crear solicitud (necesita `id_copia` válido e `id_solicitante`):
```js
fetch('/api/solicitudes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id_copia: 1, id_solicitante: 2, mensaje: '¿Me prestas?' })
}).then(r=>r.json()).then(console.log)
```
3. Aceptar solicitud (reemplazar `:id`):
```js
fetch('/api/solicitudes/1/aceptar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fecha_inicio: '2025-11-01', fecha_vencimiento: '2025-11-20' })
}).then(r=>r.json()).then(console.log)
```
4. Devolver préstamo (verificar previamente un id válido):
```js
fetch('/api/prestamos/1/devolver', { method:'POST' }).then(r=>r.json()).then(console.log)
```
5. Ir a `/api/cqrsz` y observar el incremento de `commands_executed` por cada POST.

## 📌 Señales visibles del patrón

- **Método HTTP y URL**: En DevTools → Network, distingue claramente `GET` (queries) y `POST` (commands) contra las mismas URLs.
- **Contadores /cqrsz**: El JSON refleja cuántos comandos y queries ejecutó el backend, ideal para evidenciar CQRS en demo.
- **Flujo UX**: Tras un comando (crear), la UI refresca y dispara una query (listar), reforzando la separación.

## 🧪 Guion de demo sugerido (5-7 minutos)

1. Mostrar `/api/cqrsz` (valores iniciales).
2. Abrir Libros, ver GET `/api/libros` en Network, refrescar `/api/cqrsz` (sube `queries_executed`).
3. Crear libro desde UI, ver POST `/api/libros` (sube `commands_executed`). La UI vuelve a listar (sube `queries_executed`).
4. Repetir el patrón con Usuarios o Copias.
5. Mostrar Solicitudes (crear y aceptar) para evidenciar múltiples comandos encadenados.

## 🧰 Troubleshooting

- `/api/cqrsz` no cambia:
  - Revisa que el backend esté en 3001 (`docker-compose ps`) y el front use el proxy.
  - Abre DevTools Network y confirma que las llamadas van a `/api/...`.
- Error 409 al crear usuario: correo ya registrado (esperado; comando valida unicidad).
- Error 400 en comandos: faltan campos obligatorios (esperado; handlers validan payloads).

## ✅ Checklist de evidencias CQRS

- [ ] Ver GET `/api/libros` en Network (Query)
- [ ] Ver POST `/api/libros` en Network (Command)
- [ ] Observar `/api/cqrsz` subir `queries_executed` tras GET
- [ ] Observar `/api/cqrsz` subir `commands_executed` tras POST
- [ ] Repetir patrón con Usuarios/Copias
- [ ] Flujos avanzados: Solicitudes → Aceptar → Préstamo → Devolver

Con esto, la separación Comando/Consulta queda visible desde el navegador y la UI, evidenciando la aplicación del patrón CQRS en el proyecto sin cambiar las URLs existentes.
