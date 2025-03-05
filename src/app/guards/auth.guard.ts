import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export class AuthGuard {
  private router = inject(Router);
  private authService = inject(AuthService);

  canActivate(): boolean {
    if (this.authService.isLoggedIn()) {
      return true;
    }

    // Not logged in, redirect to login
    this.router.navigate(['/login']);
    return false;
  }
}