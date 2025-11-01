export class CrearLibroHandler {
  constructor(pool, redis, eventPublisher) {
    this.pool = pool;
    this.redis = redis;
    this.eventPublisher = eventPublisher;
  }

  async handle(command) {
    if (command.type !== 'CREAR_LIBRO') throw new Error('Tipo de comando inválido');
    const { titulo, autor, isbn10, isbn13, anioPublicacion } = command.payload || {};
    if (!titulo || !autor) throw new Error('titulo y autor son obligatorios');

    const q = `INSERT INTO libro (isbn_10, isbn_13, titulo, autor, anio_publicacion)
               VALUES ($1,$2,$3,$4,$5)
               RETURNING id_libro, titulo, autor, anio_publicacion`;
    const { rows } = await this.pool.query(q, [isbn10 || null, isbn13 || null, titulo, autor, anioPublicacion || null]);

    // invalidar caché
    try { await this.redis.del('libros:all'); } catch {}

    // publicar evento (best-effort)
    try { await this.eventPublisher.publish({ type: 'LIBRO_CREADO', payload: rows[0] }); } catch {}

    return rows[0];
  }
}
