// src/app/services/auth.service.ts
import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError, Subject } from 'rxjs';
import { map, tap, catchError, finalize } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { JwtHelperService } from '@auth0/angular-jwt';

import { LoginCredentials, AuthResponse, DecodedToken } from '../models/auth.model';
import { Agent, AgentRegistration } from '../models/agent.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;
  private jwtHelper = new JwtHelperService();
  private currentAgentSubject = new BehaviorSubject<Agent | null>(null);
  public currentAgent$ = this.currentAgentSubject.asObservable();
  
  // New event for token refresh
  private tokenRefreshedSubject = new Subject<void>();
  public tokenRefreshed$ = this.tokenRefreshedSubject.asObservable();
  
  public isBrowser: boolean;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.loadCurrentAgent();
  }

  private loadCurrentAgent(): void {
    if (this.isBrowser) {
      const token = localStorage.getItem('token');
      if (token && !this.jwtHelper.isTokenExpired(token)) {
        try {
          const agent = JSON.parse(localStorage.getItem('agent') || '{}');
          this.currentAgentSubject.next(agent);
          console.log('Loaded agent from localStorage:', agent.name);
        } catch (error) {
          console.error('Error parsing agent from localStorage:', error);
          this.clearLocalStorage();
        }
      }
    }
  }

  // Login user
  login(credentials: LoginCredentials): Observable<AuthResponse> {
    console.log('[AuthService] Attempting login');
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, credentials)
      .pipe(
        tap(response => {
          console.log('[AuthService] Login successful, storing token');
          if (this.isBrowser) {
            localStorage.setItem('token', response.token);
            localStorage.setItem('agent', JSON.stringify(response.agent));
            console.log('[AuthService] Token stored, expires in:', response.expiresIn);
          }
          this.currentAgentSubject.next(response.agent);
        }),
        catchError(error => {
          console.error('[AuthService] Login error:', error);
          return throwError(() => error);
        })
      );
  }

  // Logout user
  logout(): Observable<any> {
    // Call the backend logout endpoint
    return this.http.post(`${this.apiUrl}/logout`, {}).pipe(
      finalize(() => this.clearLocalStorage()),
      catchError(error => {
        // Even if the backend call fails, clear local storage
        this.clearLocalStorage();
        return of(null);
      })
    );
  }

  // Clear local storage
  private clearLocalStorage(): void {
    if (this.isBrowser) {
      localStorage.removeItem('token');
      localStorage.removeItem('agent');
    }
    this.currentAgentSubject.next(null);
  }

  // Register a new agent
  registerAgent(agentData: AgentRegistration): Observable<Agent> {
    return this.http.post<Agent>(`${this.apiUrl}/register`, agentData);
  }

  // Refresh authentication token
  refreshToken(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/refresh`, {})
      .pipe(
        tap(response => {
          if (this.isBrowser) {
            localStorage.setItem('token', response.token);
            localStorage.setItem('agent', JSON.stringify(response.agent));
          }
          this.currentAgentSubject.next(response.agent);
          
          // Emit token refreshed event
          this.tokenRefreshedSubject.next();
          
          console.log('[AuthService] Token refreshed successfully');
        }),
        catchError(error => {
          console.error('[AuthService] Token refresh error:', error);
          return throwError(() => error);
        })
      );
  }

  // Get current token
  getToken(): string {
    if (this.isBrowser) {
      const token = localStorage.getItem('token') || '';
      const hasToken = !!token;
      console.log('[AuthService] getToken called, token exists:', hasToken);
      return token;
    }
    console.log('[AuthService] getToken called in SSR mode, returning empty string');
    return '';
  }

  // Check if user is logged in
  isLoggedIn(): boolean {
    const token = this.getToken();
    const isValid = token ? !this.jwtHelper.isTokenExpired(token) : false;
    return isValid;
  }

  // Check if user is admin
  isAdmin(): boolean {
    const agent = this.currentAgentSubject.value;
    return agent?.role === 'admin';
  }

  // Check if user is supervisor
  isSupervisor(): boolean {
    const agent = this.currentAgentSubject.value;
    return agent?.role === 'supervisor' || agent?.role === 'admin';
  }

  // Get decoded token
  getDecodedToken(): DecodedToken | null {
    const token = this.getToken();
    try {
      return token ? this.jwtHelper.decodeToken(token) : null;
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  }

  // Get current agent
  getCurrentAgent(): Agent | null {
    return this.currentAgentSubject.value;
  }

  // Update current agent
  updateCurrentAgent(agent: Agent): void {
    if (!agent) return;
    
    console.log('Updating current agent:', agent);
    
    // Update the current agent in memory
    this.currentAgentSubject.next(agent);
    
    // Also update in localStorage if browser
    if (this.isBrowser) {
      localStorage.setItem('agent', JSON.stringify(agent));
    }
  }

  // Refresh current agent data from server
  refreshCurrentAgent(): Observable<Agent> {
    return this.http.get<Agent>(`${this.apiUrl}/me`).pipe(
      tap(agent => {
        this.updateCurrentAgent(agent);
      }),
      catchError(error => {
        console.error('Error refreshing agent data:', error);
        return throwError(() => error);
      })
    );
  }
}