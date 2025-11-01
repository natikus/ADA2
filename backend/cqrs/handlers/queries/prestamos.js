export class ListarPrestamosHandler {
  constructor(pool) { this.pool = pool; }
  async handle(query) {
    if (query.type !== 'OBTENER_PRESTAMOS') throw new Error('Tipo de query inválido');
    const { id_usuario, estado } = query.filters || {};
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
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
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
    const { rows } = await this.pool.query(q, params);
    return rows;
  }
}
