export class ListarLibrosHandler {
  constructor(pool) {
    this.pool = pool;
  }

  async handle(query) {
    if (query.type !== 'OBTENER_LIBROS') throw new Error('Tipo de query inválido');
    const { q } = query.filters || {};

    if (q) {
      const { rows } = await this.pool.query(
        `SELECT id_libro, titulo, autor, anio_publicacion
         FROM libro
         WHERE titulo ILIKE '%'||$1||'%' OR autor ILIKE '%'||$1||'%'
         ORDER BY titulo ASC
         LIMIT 50`, [q]
      );
      return rows;
    }

    const { rows } = await this.pool.query(
      `SELECT id_libro, titulo, autor, anio_publicacion
       FROM libro ORDER BY creado_en DESC LIMIT 50`
    );
    return rows;
  }
}
