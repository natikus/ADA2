export class ListarUsuariosHandler {
  constructor(pool) {
    this.pool = pool;
  }

  async handle(query) {
    if (query.type !== 'OBTENER_USUARIOS') throw new Error('Tipo de query inválido');
    const { rows } = await this.pool.query(
      'SELECT id_usuario, correo, nombre_mostrar, activo, creado_en FROM usuario ORDER BY id_usuario ASC'
    );
    return rows;
  }
}
