import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Solicitud } from '../../core/api.service';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';

@Component({
  selector: 'app-solicitudes',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatListModule],
  templateUrl: './solicitudes.component.html'
})
export class SolicitudesComponent {
  private api = inject(ApiService);
  solicitudes = signal<Solicitud[]>([]);
  error = '';

  constructor() { this.listar(); }

  listar() {
    this.api.listarPrestamos().subscribe({ // revisar según tu backend si hay endpoint solicitudes
      next: r => this.solicitudes.set(r as any),
      error: () => this.error = 'Error al listar'
    });
  }

  aceptar(id: number) {
    this.api.aceptarSolicitud(id, new Date().toISOString(), new Date().toISOString())
      .subscribe({ next: () => this.listar() });
  }

  rechazar(id: number) {
    this.api.rechazarSolicitud(id).subscribe({ next: () => this.listar() });
  }
}
