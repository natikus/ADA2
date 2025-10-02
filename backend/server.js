import express from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: String(process.env.PGPASSWORD),
});


// Utilidad simple para manejar transacciones
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------
// Usuarios
// ---------------------------

// Crear usuario
app.post("/usuarios", async (req, res) => {
  try {
    const { correo, clave, nombre_mostrar } = req.body;
    if (!correo || !clave || !nombre_mostrar) {
      return res.status(400).json({ error: "correo, clave y nombre_mostrar son obligatorios" });
    }
    const hash = await bcrypt.hash(clave, 10);
    // Enforce unicidad case-insensitive
    const exists = await pool.query(
      "SELECT 1 FROM usuario WHERE LOWER(correo)=LOWER($1)",
      [correo]
    );
    if (exists.rowCount > 0) return res.status(409).json({ error: "Correo ya registrado" });

    const q = `INSERT INTO usuario (correo, clave_hash, nombre_mostrar, activo)
               VALUES ($1,$2,$3, TRUE)
               RETURNING id_usuario, correo, nombre_mostrar, activo, creado_en`;
    const { rows } = await pool.query(q, [correo, hash, nombre_mostrar]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

// Login básico (solo para test, sin JWT)
app.post("/login", async (req, res) => {
  try {
    const { correo, clave } = req.body;
    const { rows } = await pool.query(
      "SELECT id_usuario, correo, clave_hash, nombre_mostrar, activo FROM usuario WHERE LOWER(correo)=LOWER($1)",
      [correo]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Credenciales inválidas" });
    const ok = await bcrypt.compare(clave, rows[0].clave_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });
    const { clave_hash, ...rest } = rows[0];
    res.json(rest);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error en login" });
  }
});

// ---------------------------
// Libros
// ---------------------------

// Crear libro
app.post("/libros", async (req, res) => {
  try {
    const { isbn_10, isbn_13, titulo, autor, anio_publicacion } = req.body;
    if (!titulo || !autor) return res.status(400).json({ error: "titulo y autor son obligatorios" });
    const q = `INSERT INTO libro (isbn_10, isbn_13, titulo, autor, anio_publicacion)
               VALUES ($1,$2,$3,$4,$5)
               RETURNING id_libro, titulo, autor, anio_publicacion`;
    const { rows } = await pool.query(q, [isbn_10 || null, isbn_13 || null, titulo, autor, anio_publicacion || null]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear libro" });
  }
});

// Listar libros (búsqueda simple)
app.get("/libros", async (req, res) => {
  try {
    const { q } = req.query;
    if (q) {
      const { rows } = await pool.query(
        `SELECT id_libro, titulo, autor, anio_publicacion
         FROM libro
         WHERE titulo ILIKE '%'||$1||'%' OR autor ILIKE '%'||$1||'%'
         ORDER BY titulo ASC
         LIMIT 50`, [q]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `SELECT id_libro, titulo, autor, anio_publicacion
       FROM libro ORDER BY creado_en DESC LIMIT 50`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar libros" });
  }
});

// ---------------------------
// Copias (ejemplares)
// ---------------------------

// Crear copia (ejemplar) de un libro
app.post("/copias", async (req, res) => {
  try {
    const { id_libro, id_duenio, estado = "BUENO", notas = null, visibilidad = "PUBLICA" } = req.body;
    if (!id_libro || !id_duenio) return res.status(400).json({ error: "id_libro e id_duenio son obligatorios" });
    const q = `INSERT INTO copia (id_libro, id_duenio, estado, notas, visibilidad, disponible)
               VALUES ($1,$2,$3,$4,$5, TRUE)
               RETURNING id_copia, id_libro, id_duenio, estado, visibilidad, disponible`;
    const { rows } = await pool.query(q, [id_libro, id_duenio, estado, notas, visibilidad]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear copia" });
  }
});

// Listar copias (filtros opcionales)
app.get("/copias", async (req, res) => {
  try {
    const { disponible, id_libro } = req.query;
    const conds = [];
    const params = [];
    if (typeof disponible !== "undefined") {
      params.push(disponible === "1" || disponible === "true");
      conds.push(`disponible = $${params.length}`);
    }
    if (id_libro) {
      params.push(Number(id_libro));
      conds.push(`id_libro = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT c.id_copia, c.id_libro, l.titulo, l.autor, c.id_duenio, c.estado, c.visibilidad, c.disponible
       FROM copia c JOIN libro l ON l.id_libro = c.id_libro
       ${where}
       ORDER BY c.creado_en DESC
       LIMIT 100`, params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar copias" });
  }
});

// ---------------------------
// Solicitudes de préstamo
// ---------------------------

// Listar solicitudes
// Listar solicitudes (enriquecidas)
app.get("/solicitudes", async (req, res) => {
  try {
    const { rows } = await pool.query(`
SELECT
  s.id_solicitud, s.estado, s.solicitada_en, s.decidida_en,
  s.id_copia, c.id_libro,
  l.titulo AS titulo,   
  l.autor  AS autor,   
  s.id_solicitante, us.nombre_mostrar AS solicitante,
  s.id_duenio,      ud.nombre_mostrar AS duenio
FROM solicitud s
JOIN copia c  ON c.id_copia = s.id_copia
JOIN libro l  ON l.id_libro = c.id_libro
JOIN usuario us ON us.id_usuario = s.id_solicitante
JOIN usuario ud ON ud.id_usuario = s.id_duenio
ORDER BY s.id_solicitud DESC
LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar solicitudes" });
  }
});


// Crear solicitud
app.post("/solicitudes", async (req, res) => {
  try {
    const { id_copia, id_solicitante, mensaje = null } = req.body;
    if (!id_copia || !id_solicitante) {
      return res.status(400).json({ error: "id_copia e id_solicitante son obligatorios" });
    }
    // Traer dueño de la copia y estado
    const { rows: copiaRows } = await pool.query(
      "SELECT id_duenio, disponible FROM copia WHERE id_copia=$1", [id_copia]
    );
    if (copiaRows.length === 0) return res.status(404).json({ error: "Copia no encontrada" });
    const duenio = copiaRows[0].id_duenio;
    if (duenio === Number(id_solicitante)) {
      return res.status(400).json({ error: "No puedes solicitar tu propia copia" });
    }
    const q = `INSERT INTO solicitud (id_copia, id_solicitante, id_duenio, estado, mensaje)
               VALUES ($1,$2,$3,'PENDIENTE',$4)
               RETURNING id_solicitud, estado, solicitada_en`;
    const { rows } = await pool.query(q, [id_copia, id_solicitante, duenio, mensaje]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al crear solicitud" });
  }
});

// Aceptar solicitud -> crea préstamo
app.post("/solicitudes/:id/aceptar", async (req, res) => {
  const id_solicitud = Number(req.params.id);
  const { fecha_inicio, fecha_vencimiento } = req.body;
  if (!fecha_inicio || !fecha_vencimiento) {
    return res.status(400).json({ error: "fecha_inicio y fecha_vencimiento son obligatorias" });
  }

  try {
    const result = await withTx(async (client) => {
      // Bloquear solicitud
      const { rows: sRows } = await client.query(
        `SELECT id_solicitud, id_copia, id_solicitante, id_duenio, estado
         FROM solicitud WHERE id_solicitud=$1 FOR UPDATE`, [id_solicitud]
      );
      if (sRows.length === 0) throw { status: 404, msg: "Solicitud no encontrada" };
      const sol = sRows[0];
      if (sol.estado !== "PENDIENTE") throw { status: 409, msg: "La solicitud no está pendiente" };

      // Insertar préstamo (índice único evita 2 activos por copia)
      const insertLoan = `INSERT INTO prestamo
          (id_copia, id_duenio, id_prestatario, id_solicitud, estado, fecha_inicio, fecha_vencimiento)
        VALUES ($1,$2,$3,$4,'ACTIVO',$5,$6)
        RETURNING id_prestamo, id_copia, estado, fecha_inicio, fecha_vencimiento`;
      const { rows: pRows } = await client.query(insertLoan, [
        sol.id_copia, sol.id_duenio, sol.id_solicitante, sol.id_solicitud, fecha_inicio, fecha_vencimiento
      ]);

      // Marcar solicitud como aceptada
      await client.query(
        "UPDATE solicitud SET estado='ACEPTADA', decidida_en=now() WHERE id_solicitud=$1",
        [id_solicitud]
      );

      // (Opcional) actualizar disponible a false (si no tenés trigger)
      await client.query(
        `UPDATE copia SET disponible = FALSE WHERE id_copia=$1`,
        [sol.id_copia]
      );

      // Evento
      await client.query(
        `INSERT INTO evento_prestamo (id_prestamo, tipo_evento, datos)
         VALUES ($1,'CREADO', '{"origen":"aceptar_solicitud"}')`,
        [pRows[0].id_prestamo]
      );

      return pRows[0];
    });

    res.json(result);
  } catch (e) {
    console.error(e);
    if (e.code === "23505") {
      // violación de índice único: ya hay un préstamo ACTIVO/ATRASADO
      return res.status(409).json({ error: "La copia ya tiene un préstamo activo" });
    }
    const status = e.status || 500;
    res.status(status).json({ error: e.msg || "Error al aceptar solicitud" });
  }
});

// Rechazar / Cancelar solicitud
app.post("/solicitudes/:id/rechazar", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE solicitud SET estado='RECHAZADA', decidida_en=now()
       WHERE id_solicitud=$1 AND estado='PENDIENTE'`, [req.params.id]
    );
    if (rowCount === 0) return res.status(409).json({ error: "No se pudo rechazar (¿ya decidida?)" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al rechazar solicitud" });
  }
});
// Listar usuarios
app.get("/usuarios", async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT id_usuario, correo, nombre_mostrar, activo, creado_en FROM usuario ORDER BY id_usuario ASC"
      );
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Error al listar usuarios" });
    }
  });
  
// ---------------------------
// Préstamos
// ---------------------------

// Listar préstamos (filtros básicos)
app.get("/prestamos", async (req, res) => {
  try {
    const { id_usuario, estado } = req.query;
    const conds = [];
    const params = [];
    if (id_usuario) {
      params.push(Number(id_usuario));
      conds.push(`(p.id_prestatario = $${params.length} OR p.id_duenio = $${params.length})`);
    }
    if (estado) {
      params.push(estado);
      conds.push(`p.estado = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const q = `
      SELECT p.id_prestamo, p.id_copia, p.id_duenio, p.id_prestatario,
             p.estado, p.fecha_inicio, p.fecha_vencimiento, p.fecha_devolucion,
             l.titulo, l.autor
      FROM prestamo p
      JOIN copia c ON c.id_copia = p.id_copia
      JOIN libro l ON l.id_libro = c.id_libro
      ${where}
      ORDER BY p.id_prestamo DESC
      LIMIT 100`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error al listar préstamos" });
  }
});

// Devolver un préstamo
app.post("/prestamos/:id/devolver", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await withTx(async (client) => {
      // Bloquear préstamo
      const { rows } = await client.query(
        `SELECT id_prestamo, id_copia, estado FROM prestamo WHERE id_prestamo=$1 FOR UPDATE`, [id]
      );
      if (rows.length === 0) throw { status: 404, msg: "Préstamo no encontrado" };
      const p = rows[0];
      if (p.estado === "DEVUELTO") throw { status: 409, msg: "Ya está devuelto" };

      // Actualizar préstamo
      await client.query(
        `UPDATE prestamo SET estado='DEVUELTO', fecha_devolucion = CURRENT_DATE
         WHERE id_prestamo=$1`, [id]
      );

      // Marcar copia disponible
      await client.query(`UPDATE copia SET disponible = TRUE WHERE id_copia=$1`, [p.id_copia]);

      // Evento
      await client.query(
        `INSERT INTO evento_prestamo (id_prestamo, tipo_evento, datos)
         VALUES ($1,'DEVUELTO','{}')`, [id]
      );

      return { ok: true };
    });

    res.json(result);
  } catch (e) {
    console.error(e);
    const status = e.status || 500;
    res.status(status).json({ error: e.msg || "Error al devolver" });
  }
});

// ---------------------------

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
