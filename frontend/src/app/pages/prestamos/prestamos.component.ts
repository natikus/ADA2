import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, Prestamo } from '../../core/api.service';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-prestamos',
  standalone: true,
  imports: [CommonModule, MatListModule, MatButtonModule],
  templateUrl: './prestamos.component.html'
})
export class PrestamosComponent {
  private api = inject(ApiService);
  prestamos = signal<Prestamo[]>([]);
  error = '';

  constructor() { this.listar(); }

  listar() {
    this.api.listarPrestamos().subscribe({
      next: r => this.prestamos.set(r),
      error: () => this.error = 'Error al listar'
    });
  }

  devolver(id: number) {
    this.api.devolverPrestamo(id).subscribe({ next: () => this.listar() });
  }
}
