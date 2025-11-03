import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, Prestamo } from '../../core/api.service';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-prestamos',
  standalone: true,
  imports: [CommonModule, MatListModule, MatButtonModule, MatIconModule, MatCardModule],
  templateUrl: './prestamos.component.html',
  styleUrls: ['./prestamos.component.css']
})
export class PrestamosComponent {
  private api = inject(ApiService);
  prestamos = signal<Prestamo[]>([]);
  error = '';

  constructor() { this.listar(); }

  trackById = (_: number, prestamo: Prestamo) => prestamo.id_prestamo;

  listar() {
    this.api.listarPrestamos().subscribe({
      next: r => this.prestamos.set(r),
      error: () => this.error = 'Error al listar préstamos'
    });
  }

  devolver(id: number) {
    this.api.devolverPrestamo(id).subscribe({
      next: () => this.listar(),
      error: () => this.error = 'Error al devolver el préstamo'
    });
  }
}
