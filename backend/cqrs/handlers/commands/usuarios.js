import bcrypt from 'bcryptjs';

export class CrearUsuarioHandler {
  constructor(pool) {
    this.pool = pool;
  }

  async handle(command) {
    if (command.type !== 'CREAR_USUARIO') throw new Error('Tipo de comando inválido');
    const { correo, clave, nombre_mostrar } = command.payload || {};
    if (!correo || !clave || !nombre_mostrar) {
      const err = new Error('correo, clave y nombre_mostrar son obligatorios');
      err.status = 400; throw err;
    }

    const exists = await this.pool.query(
      'SELECT 1 FROM usuario WHERE LOWER(correo)=LOWER($1)', [correo]
    );
    if (exists.rowCount > 0) {
      const err = new Error('Correo ya registrado');
      err.status = 409; throw err;
    }

    const hash = await bcrypt.hash(clave, 10);
    const q = `INSERT INTO usuario (correo, clave_hash, nombre_mostrar, activo)
               VALUES ($1,$2,$3, TRUE)
               RETURNING id_usuario, correo, nombre_mostrar, activo, creado_en`;
    const { rows } = await this.pool.query(q, [correo, hash, nombre_mostrar]);
    return rows[0];
  }
}
