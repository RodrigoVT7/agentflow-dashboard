import { Routes } from '@angular/router';
import { inject } from '@angular/core'; 

// Components
import { LoginComponent } from './auth/login/login.component';
import { RegisterComponent } from './auth/register/register.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { AgentListComponent } from './admin/agent-list/agent-list.component';

// Guards
import { AuthGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  
  // Protected routes
  { 
    path: 'dashboard', 
    component: DashboardComponent, 
    canActivate: [() => inject(AuthGuard).canActivate()]
  },
  { 
    path: 'admin/agents', 
    component: AgentListComponent, 
    canActivate: [
      () => inject(AuthGuard).canActivate(),
      () => inject(AdminGuard).canActivate()
    ]
  },
  
  // Default routes
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/dashboard' }
];