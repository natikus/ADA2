export class CrearCopiaHandler {
  constructor(pool) {
    this.pool = pool;
  }

  async handle(command) {
    if (command.type !== 'CREAR_COPIA') throw new Error('Tipo de comando inválido');
    const { id_libro, id_duenio, estado = 'BUENO', notas = null, visibilidad = 'PUBLICA' } = command.payload || {};
    if (!id_libro || !id_duenio) {
      const err = new Error('id_libro e id_duenio son obligatorios');
      err.status = 400; throw err;
    }

    const q = `INSERT INTO copia (id_libro, id_duenio, estado, notas, visibilidad, disponible)
               VALUES ($1,$2,$3,$4,$5, TRUE)
               RETURNING id_copia, id_libro, id_duenio, estado, visibilidad, disponible`;
    const { rows } = await this.pool.query(q, [id_libro, id_duenio, estado, notas, visibilidad]);
    return rows[0];
  }
}
