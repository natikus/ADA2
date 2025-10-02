import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Copia } from '../../core/api.service';
import { MatListModule } from '@angular/material/list';

@Component({
  selector: 'app-copias',
  standalone: true,
  imports: [CommonModule, FormsModule, MatListModule],
  templateUrl: './copias.component.html'
})
export class CopiasComponent {
  private api = inject(ApiService);
  copias = signal<Copia[]>([]);
  error = '';

  constructor() { this.listar(); }

  listar() {
    this.api.listarCopias().subscribe({
      next: r => this.copias.set(r),
      error: () => this.error = 'Error al listar'
    });
  }
}
