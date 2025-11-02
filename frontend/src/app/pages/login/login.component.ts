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
  whoami: any;

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
      next: r => { console.log('Login ok', r); },
      error: () => this.error = 'Credenciales inválidas'
    });
  }

  async onGoogleCredential(response: any){
    try{
      const id_token = response?.credential;
      if(!id_token) return;
      const r = await fetch('/api/auth/google/callback', {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ id_token })
      });
      const data = await r.json();
      if (data?.token){
        localStorage.setItem('api_jwt', data.token);
        alert('Login federado OK: ' + data.user?.correo);
      } else {
        alert('Error autenticando');
      }
    }catch{ alert('Error autenticando'); }
  }

  async whoAmI(){
    const token = localStorage.getItem('api_jwt') || '';
    const r = await fetch('/api/whoami', { headers: { 'Authorization': 'Bearer ' + token } });
    this.whoami = await r.json();
  }
}
