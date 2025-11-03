import { Injectable, signal } from '@angular/core';


export interface SessionUser { id_usuario:number; correo:string; nombre_mostrar:string; activo:boolean; }


@Injectable({ providedIn: 'root' })
export class AuthService {
  user = signal<SessionUser|null>(this.load());

  private load(): SessionUser|null {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  }

  setUser(u:SessionUser){ 
    localStorage.setItem('user', JSON.stringify(u)); 
    this.user.set(u); 
  }

  setToken(token: string) {
    localStorage.setItem('api_jwt', token);
  }

  getToken(): string | null {
    return localStorage.getItem('api_jwt');
  }

  clear(){ 
    localStorage.removeItem('user'); 
    localStorage.removeItem('api_jwt');
    this.user.set(null); 
  }

  isLogged(){ 
    return !!this.user(); 
  }
}