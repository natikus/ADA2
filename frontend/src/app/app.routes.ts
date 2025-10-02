import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';


export const routes: Routes = [
    { path: '', redirectTo: 'libros', pathMatch: 'full' },
    { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m=>m.LoginComponent) },
    { path: 'usuarios', loadComponent: () => import('./pages/usuarios/usuarios.component').then(m=>m.UsuariosComponent) },
    { path: 'libros', loadComponent: () => import('./pages/libros/libros.component').then(m=>m.LibrosComponent) },
    { path: 'copias', loadComponent: () => import('./pages/copias/copias.component').then(m=>m.CopiasComponent) },
    { path: 'solicitudes', loadComponent: () => import('./pages/solicitudes/solicitudes.component').then(m=>m.SolicitudesComponent) },
    { path: 'prestamos', loadComponent: () => import('./pages/prestamos/prestamos.component').then(m=>m.PrestamosComponent) },
    { path: '**', redirectTo: 'libros' }
  ];
  