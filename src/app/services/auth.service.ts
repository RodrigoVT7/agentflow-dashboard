import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
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

  constructor(private http: HttpClient) {
    this.loadCurrentAgent();
  }

  private loadCurrentAgent(): void {
    const token = localStorage.getItem('token');
    if (token && !this.jwtHelper.isTokenExpired(token)) {
      const agent = JSON.parse(localStorage.getItem('agent') || '{}');
      this.currentAgentSubject.next(agent);
    }
  }

  login(credentials: LoginCredentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, credentials)
      .pipe(
        tap(response => {
          localStorage.setItem('token', response.token);
          localStorage.setItem('agent', JSON.stringify(response.agent));
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
    localStorage.removeItem('token');
    localStorage.removeItem('agent');
    this.currentAgentSubject.next(null);
  }

  registerAgent(agentData: AgentRegistration): Observable<Agent> {
    return this.http.post<Agent>(`${this.apiUrl}/register`, agentData);
  }

  refreshToken(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/refresh`, {})
      .pipe(
        tap(response => {
          localStorage.setItem('token', response.token);
          localStorage.setItem('agent', JSON.stringify(response.agent));
          this.currentAgentSubject.next(response.agent);
        })
      );
  }

  getToken(): string {
    return localStorage.getItem('token') || '';
  }

  isLoggedIn(): boolean {
    const token = this.getToken();
    return token ? !this.jwtHelper.isTokenExpired(token) : false;
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
}