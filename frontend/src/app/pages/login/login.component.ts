import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
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
  private auth = inject(AuthService);
  private router = inject(Router);
  
  correo = '';
  clave = '';
  error = '';

  constructor(){
    if (!(window as any).google){
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    (window as any).handleGoogleCredential = (response: any) => this.onGoogleCredential(response);
  }

  login() {
    this.api.login(this.correo, this.clave).subscribe({
      next: (r: any) => {
        console.log('Login ok', r);
        if (r?.token) {
          this.auth.setToken(r.token);
          this.auth.setUser(r.user);
          this.router.navigate(['/libros']);
        }
      },
      error: () => this.error = 'Credenciales inválidas'
    });
  }

  async onGoogleCredential(response: any){
    try{
      const id_token = response?.credential;
      if(!id_token) {
        this.error = 'No se recibió token de Google';
        return;
      }

      const r = await fetch('/api/auth/google/callback', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ id_token })
      });

      const data = await r.json();

      if (r.ok && data?.token){
        this.auth.setToken(data.token);
        this.auth.setUser(data.user);
        this.router.navigate(['/libros']);
        this.error = '';
      } else {
        this.error = data?.error || 'Error en autenticación federada';
        console.error('Error de autenticación:', data);
      }
    } catch (error) {
      this.error = 'Error de conexión con el servidor';
      console.error('Error en login federado:', error);
    }
  }

}
