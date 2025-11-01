
export class CrearSolicitudHandler {
  constructor(pool) { this.pool = pool; }
  async handle(command) {
    if (command.type !== 'CREAR_SOLICITUD') throw new Error('Tipo de comando inválido');
    const { id_copia, id_solicitante, mensaje = null } = command.payload || {};
    if (!id_copia || !id_solicitante) { const e = new Error('id_copia e id_solicitante son obligatorios'); e.status=400; throw e; }
    const { rows: copiaRows } = await this.pool.query('SELECT id_duenio, disponible FROM copia WHERE id_copia=$1', [id_copia]);
    if (copiaRows.length === 0) { const e = new Error('Copia no encontrada'); e.status=404; throw e; }
    const duenio = copiaRows[0].id_duenio;
    if (duenio === Number(id_solicitante)) { const e = new Error('No puedes solicitar tu propia copia'); e.status=400; throw e; }
    const q = `INSERT INTO solicitud (id_copia, id_solicitante, id_duenio, estado, mensaje)
               VALUES ($1,$2,$3,'PENDIENTE',$4)
               RETURNING id_solicitud, estado, solicitada_en`;
    const { rows } = await this.pool.query(q, [id_copia, id_solicitante, duenio, mensaje]);
    return rows[0];
  }
}

export class AceptarSolicitudHandler {
  constructor(pool) { this.pool = pool; }
  async handle(command) {
    if (command.type !== 'ACEPTAR_SOLICITUD') throw new Error('Tipo de comando inválido');
    const { id, fecha_inicio, fecha_vencimiento } = command.payload || {};
    if (!id || !fecha_inicio || !fecha_vencimiento) { const e=new Error('fecha_inicio y fecha_vencimiento son obligatorias'); e.status=400; throw e; }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: sRows } = await client.query(
        `SELECT id_solicitud, id_copia, id_solicitante, id_duenio, estado
         FROM solicitud WHERE id_solicitud=$1 FOR UPDATE`, [id]
      );
      if (sRows.length === 0) { const e=new Error('Solicitud no encontrada'); e.status=404; throw e; }
      const sol = sRows[0];
      if (sol.estado !== 'PENDIENTE') { const e=new Error('La solicitud no está pendiente'); e.status=409; throw e; }

      const insertLoan = `INSERT INTO prestamo
          (id_copia, id_duenio, id_prestatario, id_solicitud, estado, fecha_inicio, fecha_vencimiento)
        VALUES ($1,$2,$3,$4,'ACTIVO',$5,$6)
        RETURNING id_prestamo, id_copia, estado, fecha_inicio, fecha_vencimiento`;
      const { rows: pRows } = await client.query(insertLoan, [
        sol.id_copia, sol.id_duenio, sol.id_solicitante, sol.id_solicitud, fecha_inicio, fecha_vencimiento
      ]);

      await client.query("UPDATE solicitud SET estado='ACEPTADA', decidida_en=now() WHERE id_solicitud=$1", [id]);
      await client.query("UPDATE copia SET disponible = FALSE WHERE id_copia=$1", [sol.id_copia]);

      await client.query(`INSERT INTO evento_prestamo (id_prestamo, tipo_evento, datos)
         VALUES ($1,'CREADO', '{"origen":"aceptar_solicitud_cqrs"}')`, [pRows[0].id_prestamo]);

      await client.query('COMMIT');
      return pRows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') { const e = new Error('La copia ya tiene un préstamo activo'); e.status=409; throw e; }
      throw err;
    } finally { client.release(); }
  }
}

export class RechazarSolicitudHandler {
  constructor(pool) { this.pool = pool; }
  async handle(command) {
    if (command.type !== 'RECHAZAR_SOLICITUD') throw new Error('Tipo de comando inválido');
    const { id } = command.payload || {};
    if (!id) { const e=new Error('id es obligatorio'); e.status=400; throw e; }
    const { rowCount } = await this.pool.query(
      `UPDATE solicitud SET estado='RECHAZADA', decidida_en=now()
       WHERE id_solicitud=$1 AND estado='PENDIENTE'`, [id]
    );
    if (rowCount === 0) { const e=new Error('No se pudo rechazar (¿ya decidida?)'); e.status=409; throw e; }
    return { ok: true };
  }
}
