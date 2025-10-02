CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Usuarios y seguridad
CREATE TABLE app_user (
                          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          email             CITEXT UNIQUE NOT NULL,
                          phone_e164        VARCHAR(20),
                          full_name         TEXT NOT NULL,
                          password_hash     TEXT NOT NULL,
                          role              TEXT NOT NULL CHECK (role IN ('USER','MERCHANT','ADMIN')),
                          is_active         BOOLEAN NOT NULL DEFAULT TRUE,
                          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_address (
                              id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                              user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                              label        TEXT,           -- Casa, Trabajo
                              line1        TEXT NOT NULL,
                              line2        TEXT,
                              city         TEXT NOT NULL,
                              state        TEXT,
                              postal_code  TEXT,
                              country      TEXT NOT NULL DEFAULT 'UY',
                              latitude     NUMERIC(9,6),
                              longitude    NUMERIC(9,6),
                              is_default   BOOLEAN NOT NULL DEFAULT FALSE,
                              created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_address_user ON user_address(user_id);

-- Consentimientos (Ley 18.331)
CREATE TABLE user_consent (
                              id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                              user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                              purpose      TEXT NOT NULL,       -- marketing, analytics, etc.
                              granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                              revoked_at   TIMESTAMPTZ
);

-- Aceptación de Términos/Política
CREATE TABLE legal_acceptance (
                                  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                  user_id        UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                                  doc_type       TEXT NOT NULL CHECK (doc_type IN ('TOS','PRIVACY')),
                                  doc_version    TEXT NOT NULL,
                                  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                                  ip_address     INET
);

-- =========================
-- Comercios y sucursales
-- =========================
CREATE TABLE merchant (
                          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          owner_user_id  UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
                          legal_name     TEXT NOT NULL,
                          trade_name     TEXT NOT NULL,
                          rut            VARCHAR(12),          -- RUT uruguayo
                          email          CITEXT,
                          phone_e164     VARCHAR(20),
                          status         TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','SUSPENDED')) DEFAULT 'PENDING',
                          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_merchant_rut ON merchant(rut);

CREATE TABLE store (
                       id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                       merchant_id      UUID NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
                       name             TEXT NOT NULL,
                       description      TEXT,
                       address_line1    TEXT NOT NULL,
                       address_line2    TEXT,
                       city             TEXT NOT NULL,
                       state            TEXT,
                       postal_code      TEXT,
                       latitude         NUMERIC(9,6),
                       longitude        NUMERIC(9,6),
                       pickup_instructions TEXT,
                       is_active        BOOLEAN NOT NULL DEFAULT TRUE,
                       created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_store_merchant ON store(merchant_id);
CREATE INDEX idx_store_geo ON store(latitude, longitude);

-- Horarios (por día de semana)
CREATE TABLE store_hours (
                             id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                             store_id     UUID NOT NULL REFERENCES store(id) ON DELETE CASCADE,
                             weekday      INT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Domingo
                             open_time    TIME NOT NULL,
                             close_time   TIME NOT NULL
);
CREATE UNIQUE INDEX uq_store_hours ON store_hours(store_id, weekday);

-- =========================
-- Ofertas: Bolsas Sorpresa
-- =========================
CREATE TABLE category (
                          id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          name  TEXT UNIQUE NOT NULL -- panadería, supermercado, restaurante, etc.
);

CREATE TABLE allergy_tag (
                             id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                             name  TEXT UNIQUE NOT NULL -- gluten, frutos secos, lácteos, etc.
);

CREATE TABLE surprise_bag (
                              id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                              store_id           UUID NOT NULL REFERENCES store(id) ON DELETE CASCADE,
                              title              TEXT NOT NULL,
                              description        TEXT,
                              category_id        UUID REFERENCES category(id),
                              original_value     NUMERIC(12,2) NOT NULL CHECK (original_value > 0),
                              price              NUMERIC(12,2) NOT NULL CHECK (price > 0 AND price <= original_value),
                              qty_available      INT NOT NULL CHECK (qty_available >= 0),
                              pickup_start       TIMESTAMPTZ NOT NULL,
                              pickup_end         TIMESTAMPTZ NOT NULL,
                              status             TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SOLD_OUT','CANCELLED')) DEFAULT 'DRAFT',
                              created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                              CHECK (pickup_end > pickup_start)
);
CREATE INDEX idx_bag_store ON surprise_bag(store_id);
CREATE INDEX idx_bag_pickup_window ON surprise_bag(pickup_start, pickup_end);

CREATE TABLE surprise_bag_allergy (
                                      bag_id   UUID NOT NULL REFERENCES surprise_bag(id) ON DELETE CASCADE,
                                      tag_id   UUID NOT NULL REFERENCES allergy_tag(id) ON DELETE CASCADE,
                                      PRIMARY KEY (bag_id, tag_id)
);

-- =========================
-- Carrito y pedidos
-- =========================
CREATE TABLE cart (
                      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                      user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                      status      TEXT NOT NULL CHECK (status IN ('ACTIVE','CONVERTED','ABANDONED')) DEFAULT 'ACTIVE',
                      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cart_user ON cart(user_id);

CREATE TABLE cart_item (
                           id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                           cart_id       UUID NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
                           bag_id        UUID NOT NULL REFERENCES surprise_bag(id) ON DELETE RESTRICT,
                           quantity      INT NOT NULL CHECK (quantity > 0),
                           unit_price    NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),
                           added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                           UNIQUE(cart_id, bag_id)
);

CREATE TABLE "order" (
                         id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                         user_id            UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
                         store_id           UUID NOT NULL REFERENCES store(id) ON DELETE RESTRICT,
                         status             TEXT NOT NULL CHECK (status IN ('PENDING','PAID','READY','PICKED_UP','CANCELLED','REFUNDED')),
                         total_amount       NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
                         pickup_code        VARCHAR(12) UNIQUE, -- para mostrar/escaneo
                         pickup_start       TIMESTAMPTZ NOT NULL,
                         pickup_end         TIMESTAMPTZ NOT NULL,
                         created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                         updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                         CHECK (pickup_end > pickup_start)
);
CREATE INDEX idx_order_user ON "order"(user_id);
CREATE INDEX idx_order_store ON "order"(store_id);

CREATE TABLE order_item (
                            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                            order_id      UUID NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
                            bag_id        UUID NOT NULL REFERENCES surprise_bag(id) ON DELETE RESTRICT,
                            quantity      INT NOT NULL CHECK (quantity > 0),
                            unit_price    NUMERIC(12,2) NOT NULL CHECK (unit_price > 0)
);

-- =========================
-- Pagos, reembolsos y disputas
-- =========================
CREATE TABLE payment_method (
                                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                name        TEXT NOT NULL,            -- "Mercado Pago", "Redpagos", etc.
                                provider    TEXT NOT NULL,            -- "mercadopago", "redpagos"
                                is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE payment (
                         id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                         order_id        UUID NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
                         method_id       UUID NOT NULL REFERENCES payment_method(id),
                         provider_status TEXT NOT NULL,        -- approved, in_process, rejected
                         provider_ref    TEXT,                 -- id operación MP
                         amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
                         paid_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_payment_order ON payment(order_id);

CREATE TABLE refund (
                        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        order_id      UUID NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
                        payment_id    UUID REFERENCES payment(id) ON DELETE SET NULL,
                        reason        TEXT NOT NULL,          -- no stock, calidad, etc.
                        status        TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','PROCESSED')),
                        requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                        processed_at  TIMESTAMPTZ,
    -- Política inspirada en TGTG: reclamos hasta 30 días tras la franja
                        CHECK (
                            processed_at IS NULL
                                OR processed_at >= requested_at
                            )
);

-- =========================
-- Ratings, favoritos y notificaciones
-- =========================
CREATE TABLE rating (
                        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        order_id    UUID NOT NULL UNIQUE REFERENCES "order"(id) ON DELETE CASCADE,
                        user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                        store_id    UUID NOT NULL REFERENCES store(id) ON DELETE CASCADE,
                        stars       INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
                        comment     TEXT,
                        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rating_store ON rating(store_id);

CREATE TABLE favorite_store (
                                user_id   UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                                store_id  UUID NOT NULL REFERENCES store(id) ON DELETE CASCADE,
                                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                                PRIMARY KEY (user_id, store_id)
);

CREATE TABLE notification_token (
                                    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                    user_id   UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
                                    channel   TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','PUSH')),
                                    token     TEXT NOT NULL,
                                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- Auditoría
-- =========================
CREATE TABLE audit_log (
                           id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                           actor_user  UUID REFERENCES app_user(id) ON DELETE SET NULL,
                           action      TEXT NOT NULL,
                           entity      TEXT NOT NULL,
                           entity_id   UUID,
                           meta        JSONB,
                           created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de ayuda
CREATE INDEX idx_bag_status ON surprise_bag(status);
CREATE INDEX idx_order_status ON "order"(status);