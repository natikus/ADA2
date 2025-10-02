import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';


export interface Usuario { id_usuario:number; correo:string; nombre_mostrar:string; activo:boolean; creado_en:string; }
export interface UsuarioCreate { correo:string; clave:string; nombre_mostrar:string; }


export interface Libro { id_libro:number; titulo:string; autor:string; anio_publicacion:number|null; }
export interface LibroCreate { isbn_10?:string; isbn_13?:string; titulo:string; autor:string; anio_publicacion?:number; }


export interface Copia { id_copia:number; id_libro:number; titulo:string; autor:string; id_duenio:number; estado:string; visibilidad:string; disponible:boolean; }
export interface CopiaCreate { id_libro:number; id_duenio:number; estado?:string; notas?:string|null; visibilidad?:string; }


export interface Solicitud {
  id_solicitud: string;         
  estado: 'PENDIENTE'|'ACEPTADA'|'RECHAZADA'|'CANCELADA';
  solicitada_en: string;
  decidida_en?: string | null;
  id_copia: string;             
  id_libro: string;              
  titulo: string;
  autor: string;
  id_solicitante: string;       
  solicitante: string;
  id_duenio: string;            
  duenio: string;
}


export interface Prestamo { id_prestamo:number; id_copia:number; id_duenio:number; id_prestatario:number; estado:string; fecha_inicio:string; fecha_vencimiento:string; fecha_devolucion:string|null; titulo:string; autor:string; }


@Injectable({ providedIn: 'root' })
export class ApiService {
private http = inject(HttpClient);
private base = '/api';


// Usuarios
crearUsuario(dto: UsuarioCreate){ return this.http.post<Usuario>(`${this.base}/usuarios`, dto); }
listarUsuarios(){ return this.http.get<Usuario[]>(`${this.base}/usuarios`); }
login(correo:string, clave:string){ return this.http.post<any>(`${this.base}/login`, { correo, clave }); }


// Libros
crearLibro(dto: LibroCreate){ return this.http.post<Libro>(`${this.base}/libros`, dto); }
listarLibros(q?:string){
const params = q ? new HttpParams().set('q', q) : undefined;
return this.http.get<Libro[]>(`${this.base}/libros`, { params });
}


// Copias
crearCopia(dto: CopiaCreate){ return this.http.post<Copia>(`${this.base}/copias`, dto); }
listarCopias(opts:{disponible?:boolean; id_libro?:number}={}){
let params = new HttpParams();
if (opts.disponible!==undefined) params = params.set('disponible', String(opts.disponible));
if (opts.id_libro!==undefined) params = params.set('id_libro', String(opts.id_libro));
return this.http.get<Copia[]>(`${this.base}/copias`, { params });
}


// Solicitudes

listarSolicitudes() {
  return this.http.get<Solicitud[]>(`${this.base}/solicitudes`);
}
crearSolicitud(id_copia:number, id_solicitante:number, mensaje?:string){
return this.http.post<Solicitud>(`${this.base}/solicitudes`, { id_copia, id_solicitante, mensaje });
}
aceptarSolicitud(id:number, fecha_inicio:string, fecha_vencimiento:string){
return this.http.post(`${this.base}/solicitudes/${id}/aceptar`, { fecha_inicio, fecha_vencimiento });
}
rechazarSolicitud(id:number){ return this.http.post(`${this.base}/solicitudes/${id}/rechazar`, {}); }


// Préstamos
listarPrestamos(opts:{id_usuario?:number; estado?:string}={}){
let params = new HttpParams();
if (opts.id_usuario!==undefined) params = params.set('id_usuario', String(opts.id_usuario));
if (opts.estado) params = params.set('estado', opts.estado);
return this.http.get<Prestamo[]>(`${this.base}/prestamos`, { params });
}
devolverPrestamo(id:number){ return this.http.post(`${this.base}/prestamos/${id}/devolver`, {}); }
}