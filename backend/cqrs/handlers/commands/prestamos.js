
export class DevolverPrestamoHandler {
  constructor(pool) { this.pool = pool; }
  async handle(command) {
    if (command.type !== 'DEVOLVER_PRESTAMO') throw new Error('Tipo de comando inválido');
    const { id } = command.payload || {};
    if (!id) { const e = new Error('id es obligatorio'); e.status=400; throw e; }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id_prestamo, id_copia, estado FROM prestamo WHERE id_prestamo=$1 FOR UPDATE`, [id]
      );
      if (rows.length === 0) { const e=new Error('Préstamo no encontrado'); e.status=404; throw e; }
      const p = rows[0];
      if (p.estado === 'DEVUELTO') { const e=new Error('Ya está devuelto'); e.status=409; throw e; }

      await client.query(
        `UPDATE prestamo SET estado='DEVUELTO', fecha_devolucion = CURRENT_DATE
         WHERE id_prestamo=$1`, [id]
      );
      await client.query(`UPDATE copia SET disponible = TRUE WHERE id_copia=$1`, [p.id_copia]);
      await client.query(
        `INSERT INTO evento_prestamo (id_prestamo, tipo_evento, datos)
         VALUES ($1,'DEVUELTO','{}')`, [id]
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  }
}
