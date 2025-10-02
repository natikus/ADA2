CREATE EXTENSION IF NOT EXISTS citext;
-- =========================
-- Tipos enumerados
-- =========================
CREATE TYPE estado_solicitud AS ENUM ('PENDIENTE','ACEPTADA','RECHAZADA','CANCELADA');
CREATE TYPE estado_prestamo  AS ENUM ('ACTIVO','ATRASADO','DEVUELTO','CANCELADO');
CREATE TYPE visibilidad_copia AS ENUM ('PUBLICA','OCULTA');
CREATE TYPE estado_libro AS ENUM ('NUEVO','CASI_NUEVO','BUENO','REGULAR','MALO');

-- =========================
-- Usuarios y roles
-- =========================
CREATE TABLE usuario (
  id_usuario       BIGSERIAL PRIMARY KEY,
  correo           CITEXT UNIQUE NOT NULL,
  clave_hash       TEXT NOT NULL,                 -- bcrypt/argon2
  nombre_mostrar   TEXT NOT NULL,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_login_en  TIMESTAMPTZ
);

CREATE TABLE rol (
  id_rol   SMALLSERIAL PRIMARY KEY,
  clave    TEXT UNIQUE NOT NULL                 -- 'ADMIN','USUARIO'
);

INSERT INTO rol (clave) VALUES ('ADMIN'), ('USUARIO');

CREATE TABLE usuario_rol (
  id_usuario BIGINT REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  id_rol     SMALLINT REFERENCES rol(id_rol) ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_rol)
);

-- =========================
-- Catálogo de libros
-- =========================
CREATE TABLE libro (
  id_libro      BIGSERIAL PRIMARY KEY,
  isbn_10       TEXT,
  isbn_13       TEXT,
  titulo        TEXT NOT NULL,
  autor         TEXT NOT NULL,
  anio_publicacion INT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX libro_titulo_idx ON libro USING GIN (to_tsvector('spanish', coalesce(titulo,'')));
CREATE INDEX libro_autor_idx  ON libro USING GIN (to_tsvector('spanish', coalesce(autor,'')));

CREATE TABLE categoria (
  id_categoria SERIAL PRIMARY KEY,
  nombre       TEXT UNIQUE NOT NULL
);

CREATE TABLE libro_categoria (
  id_libro     BIGINT REFERENCES libro(id_libro) ON DELETE CASCADE,
  id_categoria INT REFERENCES categoria(id_categoria) ON DELETE CASCADE,
  PRIMARY KEY (id_libro, id_categoria)
);

-- =========================
-- Copias (ejemplares)
-- =========================
CREATE TABLE copia (
  id_copia      BIGSERIAL PRIMARY KEY,
  id_libro      BIGINT NOT NULL REFERENCES libro(id_libro) ON DELETE CASCADE,
  id_duenio     BIGINT NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  estado        estado_libro NOT NULL DEFAULT 'BUENO',
  notas         TEXT,
  visibilidad   visibilidad_copia NOT NULL DEFAULT 'PUBLICA',
  disponible    BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- Solicitudes de préstamo
-- =========================
CREATE TABLE solicitud (
  id_solicitud    BIGSERIAL PRIMARY KEY,
  id_copia        BIGINT NOT NULL REFERENCES copia(id_copia) ON DELETE CASCADE,
  id_solicitante  BIGINT NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  id_duenio       BIGINT NOT NULL,  -- redundante, igual al dueño de la copia
  estado          estado_solicitud NOT NULL DEFAULT 'PENDIENTE',
  mensaje         TEXT,
  solicitada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidida_en     TIMESTAMPTZ
);

-- =========================
-- Préstamos confirmados
-- =========================
CREATE TABLE prestamo (
  id_prestamo     BIGSERIAL PRIMARY KEY,
  id_copia        BIGINT NOT NULL REFERENCES copia(id_copia) ON DELETE CASCADE,
  id_duenio       BIGINT NOT NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  id_prestatario  BIGINT NOT NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  id_solicitud    BIGINT UNIQUE REFERENCES solicitud(id_solicitud) ON DELETE SET NULL,
  estado          estado_prestamo NOT NULL DEFAULT 'ACTIVO',
  fecha_inicio    DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  fecha_devolucion DATE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fecha_vencimiento >= fecha_inicio),
  CHECK ((estado <> 'DEVUELTO') OR (fecha_devolucion IS NOT NULL))
);

CREATE UNIQUE INDEX prestamo_unico_copia_activa
  ON prestamo(id_copia)
  WHERE estado IN ('ACTIVO','ATRASADO') AND fecha_devolucion IS NULL;

-- =========================
-- Historial / auditoría
-- =========================
CREATE TABLE evento_prestamo (
  id_evento    BIGSERIAL PRIMARY KEY,
  id_prestamo  BIGINT NOT NULL REFERENCES prestamo(id_prestamo) ON DELETE CASCADE,
  ocurrido_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo_evento  TEXT NOT NULL,               -- 'CREADO','DEVUELTO','ATRASADO', etc.
  datos        JSONB
);

INSERT INTO usuario (correo, clave_hash, nombre_mostrar, activo)
VALUES
  ('ana@example.com', 'hash1', 'Ana', TRUE),
  ('luis@example.com', 'hash2', 'Luis', TRUE),
  ('maria@example.com', 'hash3', 'María', TRUE),
  ('pedro@example.com', 'hash4', 'Pedro', TRUE);

INSERT INTO usuario_rol (id_usuario, id_rol)
VALUES
  (1, 2),  -- Ana -> USUARIO
  (2, 2),  -- Luis -> USUARIO
  (3, 2),  -- María -> USUARIO
  (4, 1);  -- Pedro -> ADMIN
INSERT INTO libro (isbn_10, titulo, autor, anio_publicacion)
VALUES
  ('1234567890', 'El Principito', 'Antoine de Saint-Exupéry', 1943),
  ('9876543210', 'Cien años de soledad', 'Gabriel García Márquez', 1967),
  ('2468135790', 'La sombra del viento', 'Carlos Ruiz Zafón', 2001);
INSERT INTO copia (id_libro, id_duenio, estado, visibilidad, disponible)
VALUES
  (1, 1, 'BUENO', 'PUBLICA', TRUE),   -- Ana tiene "El Principito"
  (2, 2, 'NUEVO', 'PUBLICA', TRUE),   -- Luis tiene "Cien años de soledad"
  (3, 3, 'CASI_NUEVO', 'PUBLICA', TRUE); -- María tiene "La sombra del viento"
-- Luis pide prestado el Principito a Ana
INSERT INTO solicitud (id_copia, id_solicitante, id_duenio, mensaje)
VALUES (1, 2, 1, '¿Me prestás El Principito?');

-- María pide prestado Cien años de soledad a Luis
INSERT INTO solicitud (id_copia, id_solicitante, id_duenio, mensaje)
VALUES (2, 3, 2, 'Lo necesito para un trabajo de literatura.');

-- Pedro pide prestado La sombra del viento a María
INSERT INTO solicitud (id_copia, id_solicitante, id_duenio, mensaje)
VALUES (3, 4, 3, 'Quiero leer este clásico.');
INSERT INTO prestamo (id_copia, id_duenio, id_prestatario, id_solicitud, estado, fecha_inicio, fecha_vencimiento)
VALUES
  (1, 1, 2, 1, 'ACTIVO', '2025-10-02', '2025-10-16');
UPDATE solicitud SET estado='ACEPTADA', decidida_en=now() WHERE id_solicitud=1;
INSERT INTO evento_prestamo (id_prestamo, tipo_evento, datos)
VALUES
  (1, 'CREADO', '{"origen":"insert manual"}');
