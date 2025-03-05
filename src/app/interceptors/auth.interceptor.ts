import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError, BehaviorSubject, Observable } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

// Use a mutable state object instead of constants
const state = {
  isRefreshing: false,
  refreshTokenSubject: new BehaviorSubject<string | null>(null)
};

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  
  // Add auth token to request if available
  const token = authService.getToken();
  
  if (token) {
    req = addTokenToRequest(req, token);
  }
  
  // Handle the response
  return next(req).pipe(
    catchError(error => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // Try token refresh if the error has an "expired" field
        if (error.error?.expired) {
          return handleRefreshToken(req, next, authService, router);
        } else {
          // Otherwise log out
          authService.logout().subscribe(() => {
            router.navigate(['/login']);
          });
        }
      }
      
      return throwError(() => error);
    })
  );
};

function addTokenToRequest(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });
}

function handleRefreshToken(
  req: HttpRequest<unknown>, 
  next: HttpHandlerFn,
  authService: AuthService, 
  router: Router
): Observable<any> {
  // If not already refreshing, start the refresh process
  if (!state.isRefreshing) {
    state.isRefreshing = true;
    state.refreshTokenSubject.next(null);

    return authService.refreshToken().pipe(
      switchMap(response => {
        state.isRefreshing = false;
        state.refreshTokenSubject.next(response.token);
        
        return next(addTokenToRequest(req, response.token));
      }),
      catchError(err => {
        state.isRefreshing = false;
        
        // If refresh fails, log out
        authService.logout().subscribe(() => {
          router.navigate(['/login']);
        });
        
        return throwError(() => err);
      })
    );
  } else {
    // Wait for token refresh to complete
    return state.refreshTokenSubject.pipe(
      filter(token => token !== null),
      take(1),
      switchMap(token => {
        return next(addTokenToRequest(req, token!));
      })
    );
  }
}