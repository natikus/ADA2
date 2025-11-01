export class ListarCopiasHandler {
  constructor(pool) {
    this.pool = pool;
  }

  async handle(query) {
    if (query.type !== 'OBTENER_COPIAS') throw new Error('Tipo de query inválido');
    const { disponible, id_libro } = query.filters || {};

    const conds = [];
    const params = [];
    if (typeof disponible !== 'undefined') {
      params.push(disponible === true || disponible === 'true' || disponible === 1 || disponible === '1');
      conds.push(`disponible = $${params.length}`);
    }
    if (id_libro) {
      params.push(Number(id_libro));
      conds.push(`id_libro = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await this.pool.query(
      `SELECT c.id_copia, c.id_libro, l.titulo, l.autor, c.id_duenio, c.estado, c.visibilidad, c.disponible
       FROM copia c JOIN libro l ON l.id_libro = c.id_libro
       ${where}
       ORDER BY c.creado_en DESC
       LIMIT 100`, params
    );
    return rows;
  }
}
