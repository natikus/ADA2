import { Component, inject, NgZone, ChangeDetectorRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  correo = '';
  clave = '';
  error = '';

  ngAfterViewInit() {
    this.initializeGoogleButton();
  }

  ngOnDestroy() {
    const googleButton = document.querySelector('.g_id_signin');
    if (googleButton) {
      googleButton.innerHTML = '';
    }
  }

  private initializeGoogleButton() {
    if ((window as any).google && (window as any).google.accounts) {
      try {
        (window as any).google.accounts.id.cancel();

        (window as any).google.accounts.id.initialize({
          client_id: '779186586574-jmgaqgkco4vk03m1pm12mns8gi38fhct.apps.googleusercontent.com',
          callback: (response: any) => this.ngZone.run(() => this.onGoogleCredential(response))
        });

        this.renderGoogleButton();
      } catch (error) {
        console.error('Error inicializando botón de Google:', error);
        setTimeout(() => this.renderGoogleButton(), 1000);
      }
    } else {
      setTimeout(() => this.initializeGoogleButton(), 500);
    }
  }

  private renderGoogleButton() {
    try {
      const buttonContainer = document.querySelector('.g_id_signin');
      if (buttonContainer) {
        buttonContainer.innerHTML = '';

        (window as any).google.accounts.id.renderButton(
          buttonContainer,
          {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: buttonContainer.clientWidth || 400
          }
        );
      }
    } catch (error) {
      console.error('Error renderizando botón de Google:', error);
    }
  }

  constructor(){
    if (!(window as any).google || !(window as any).google.accounts) {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => {
        console.log('Script de Google cargado exitosamente');
      };
      s.onerror = () => {
        console.error('Error al cargar script de Google');
      };
      document.head.appendChild(s);
    }
    (window as any).handleGoogleCredential = (response: any) => this.onGoogleCredential(response);
  }

  login() {
    if (!this.correo?.trim() || !this.clave?.trim()) {
      this.error = 'Por favor ingresa tu correo y contraseña';
      return;
    }

    this.error = '';
    this.api.login(this.correo.trim(), this.clave).subscribe({
      next: (r: any) => {
        console.log('Login exitoso', r);
        if (r?.token) {
          this.auth.setToken(r.token);
          this.auth.setUser(r.user);
          this.router.navigate(['/libros']);
        } else {
          this.error = 'Respuesta inválida del servidor';
        }
      },
      error: (error) => {
        console.error('Error de login:', error);
        if (error?.status === 401) {
          this.error = 'Credenciales inválidas';
        } else if (error?.status === 0) {
          this.error = 'Error de conexión con el servidor';
        } else {
          this.error = error?.error?.error || 'Error al iniciar sesión';
        }
      }
    });
  }

  async onGoogleCredential(response: any){
    try{
      const id_token = response?.credential;
      if(!id_token) {
        this.error = 'No se recibió token de Google';
        this.cdr.detectChanges();
        return;
      }

      this.error = '';
      this.cdr.detectChanges();

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
      } else {
        this.error = data?.error || 'Error en autenticación federada';
        console.error('Error de autenticación:', data);
        this.cdr.detectChanges();
      }
    } catch (error) {
      this.error = 'Error de conexión con el servidor';
      console.error('Error en login federado:', error);
      this.cdr.detectChanges();
    }
  }

}
