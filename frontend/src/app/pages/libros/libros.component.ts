import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Libro } from '../../core/api.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-libros',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatButtonModule, MatListModule,
    MatIconModule, MatCardModule
  ],
  templateUrl: './libros.component.html',
  styleUrls: ['./libros.component.css']
})
export class LibrosComponent {
  private api = inject(ApiService);
  titulo = '';
  autor = '';
  anio_publicacion?: number;
  libros = signal<Libro[]>([]);
  error = '';

  constructor() { this.listar(); }

  trackById(index: number, libro: Libro): number {
    return libro.id_libro;
  }

  listar() {
    this.api.listarLibros().subscribe({
      next: r => this.libros.set(r),
      error: () => this.error = 'Error al listar'
    });
  }

  crear() {
    if (!this.titulo?.trim() || !this.autor?.trim() || !this.anio_publicacion) {
      this.error = 'Todos los campos son requeridos';
      return;
    }

    this.api.crearLibro({ titulo: this.titulo.trim(), autor: this.autor.trim(), anio_publicacion: this.anio_publicacion })
      .subscribe({
        next: () => {
          this.titulo = '';
          this.autor = '';
          this.anio_publicacion = undefined;
          this.error = '';
          this.listar();
        },
        error: e => this.error = e?.error?.error || 'Error al crear el libro'
      });
  }
}
