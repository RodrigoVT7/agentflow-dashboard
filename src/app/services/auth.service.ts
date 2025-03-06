import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
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
        const agent = JSON.parse(localStorage.getItem('agent') || '{}');
        this.currentAgentSubject.next(agent);
      }
    }
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    console.log('[AuthService] Attempting login');
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, credentials)
      .pipe(
        tap(response => {
          console.log('[AuthService] Login successful, storing token');
          if (this.isBrowser) {
            localStorage.setItem('token', response.token);
            localStorage.setItem('agent', JSON.stringify(response.agent));
            // Log token information (but not the actual token for security)
            console.log('[AuthService] Token stored, expires in:', response.expiresIn);
          }
          this.currentAgentSubject.next(response.agent);
        })
      );
  }
  

  logout(): Observable<any> {
    // Call the backend logout endpoint
    return this.http.post(`${this.apiUrl}/logout`, {}).pipe(
      tap(() => this.clearLocalStorage()),
      catchError(error => {
        // Even if the backend call fails, clear local storage
        this.clearLocalStorage();
        return of(null);
      })
    );
  }

  private clearLocalStorage(): void {
    if (this.isBrowser) {
      localStorage.removeItem('token');
      localStorage.removeItem('agent');
    }
    this.currentAgentSubject.next(null);
  }

  registerAgent(agentData: AgentRegistration): Observable<Agent> {
    return this.http.post<Agent>(`${this.apiUrl}/register`, agentData);
  }

  refreshToken(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/refresh`, {})
      .pipe(
        tap(response => {
          if (this.isBrowser) {
            localStorage.setItem('token', response.token);
            localStorage.setItem('agent', JSON.stringify(response.agent));
          }
          this.currentAgentSubject.next(response.agent);
        })
      );
  }

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

  isLoggedIn(): boolean {
    const token = this.getToken();
    const isValid = token ? !this.jwtHelper.isTokenExpired(token) : false;
    console.log('[AuthService] isLoggedIn called, result:', isValid);
    return isValid;
  }

  isAdmin(): boolean {
    const agent = this.currentAgentSubject.value;
    return agent?.role === 'admin';
  }

  isSupervisor(): boolean {
    const agent = this.currentAgentSubject.value;
    return agent?.role === 'supervisor' || agent?.role === 'admin';
  }

  getDecodedToken(): DecodedToken | null {
    const token = this.getToken();
    return token ? this.jwtHelper.decodeToken(token) : null;
  }

  getCurrentAgent(): Agent | null {
    return this.currentAgentSubject.value;
  }

  // New methods for agent status management
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

  // Add this method to refresh the current agent data from server
  refreshCurrentAgent(): Observable<Agent> {
    return this.http.get<Agent>(`${this.apiUrl}/me`).pipe(
      tap(agent => {
        this.updateCurrentAgent(agent);
      })
    );
  }
}