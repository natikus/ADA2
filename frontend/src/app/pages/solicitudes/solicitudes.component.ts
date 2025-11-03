import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Solicitud } from '../../core/api.service';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-solicitudes',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatListModule, MatIconModule, MatCardModule],
  templateUrl: './solicitudes.component.html',
  styleUrls: ['./solicitudes.component.css']
})
export class SolicitudesComponent {
  private api = inject(ApiService);
  solicitudes = signal<Solicitud[]>([]);
  error = '';

  constructor() { this.listar(); }
  trackById = (_: number, s: Solicitud) => s.id_solicitud;

  listar() {
    this.api.listarSolicitudes().subscribe({
      next: r => this.solicitudes.set(r),
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
