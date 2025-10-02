import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private api = inject(ApiService);
  correo = '';
  clave = '';
  error = '';

  login() {
    this.api.login(this.correo, this.clave).subscribe({
      next: r => { console.log('Login ok', r); },
      error: () => this.error = 'Credenciales inválidas'
    });
  }
}
