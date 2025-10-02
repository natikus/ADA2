import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Libro } from '../../core/api.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';

@Component({
  selector: 'app-libros',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatButtonModule, MatListModule
  ],
  templateUrl: './libros.component.html'
})
export class LibrosComponent {
  private api = inject(ApiService);
  titulo = '';
  autor = '';
  anio_publicacion?: number;
  libros = signal<Libro[]>([]);
  error = '';

  constructor() { this.listar(); }

  listar() {
    this.api.listarLibros().subscribe({
      next: r => this.libros.set(r),
      error: () => this.error = 'Error al listar'
    });
  }

  crear() {
    this.api.crearLibro({ titulo: this.titulo, autor: this.autor, anio_publicacion: this.anio_publicacion })
      .subscribe({
        next: () => { this.titulo=''; this.autor=''; this.anio_publicacion=undefined; this.listar(); },
        error: e => this.error = e?.error?.error || 'Error al crear'
      });
  }
}
