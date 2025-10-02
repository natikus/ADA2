import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { ApiService, Copia } from '../../core/api.service';

@Component({
  selector: 'app-copias',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule],
  templateUrl: './copias.component.html',
  styleUrls: ['./copias.component.css']
})
export class CopiasComponent {
  private api = inject(ApiService);
  copias = signal<Copia[]>([]);
  error = '';
  currentUserId = 2; // demo

  constructor() { this.listar(); }

  listar() {
    this.api.listarCopias().subscribe({
      next: r => this.copias.set(r),
      error: () => this.error = 'Error al listar copias'
    });
  }

  solicitar(id_copia: number) {
    const c = this.copias().find(x => x.id_copia === id_copia);
    if (!c || !c.disponible || c.id_duenio === this.currentUserId) return;
    this.error = '';
    this.api.crearSolicitud(id_copia, this.currentUserId, 'Quiero pedir esta copia')
      .subscribe({
        next: () => this.listar(),
        error: e => this.error = e?.error?.error || 'No se pudo crear la solicitud'
      });
  }

  trackById = (_: number, c: Copia) => c.id_copia;
}
