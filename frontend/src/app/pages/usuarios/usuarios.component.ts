import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Usuario } from '../../core/api.service';

// Angular Material
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    // 👇 Material
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatListModule,
    MatIconModule
  ],
  templateUrl: './usuarios.component.html'
})
export class UsuariosComponent {
  private api = inject(ApiService);

  correo = '';
  clave = '';
  nombre_mostrar = '';
  usuarios = signal<Usuario[]>([]);
  error = '';

  constructor() { this.listar(); }

  listar() {
    this.api.listarUsuarios().subscribe({
      next: r => this.usuarios.set(r),
      error: () => this.error = 'Error al listar'
    });
  }

  crear() {
    this.api.crearUsuario({
      correo: this.correo,
      clave: this.clave,
      nombre_mostrar: this.nombre_mostrar
    }).subscribe({
      next: () => {
        this.correo = ''; this.clave = ''; this.nombre_mostrar = '';
        this.error = '';
        this.listar();
      },
      error: e => this.error = e?.error?.error || 'Error al crear'
    });
  }
}
