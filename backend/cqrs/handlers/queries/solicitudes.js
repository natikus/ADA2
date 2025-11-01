export class ListarSolicitudesHandler {
  constructor(pool) { this.pool = pool; }

  async handle(query) {
    if (query.type !== 'OBTENER_SOLICITUDES') throw new Error('Tipo de query inválido');
    const { rows } = await this.pool.query(`
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
    return rows;
  }
}
