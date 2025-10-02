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