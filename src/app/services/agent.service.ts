import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Agent, AgentStatus } from '../models/agent.model';
import { environment } from '../../environments/environment';
import { WebsocketService } from './websocket.service';

@Injectable({
  providedIn: 'root'
})
export class AgentService {
  private apiUrl = `${environment.apiUrl}/agent`;

  constructor(
    private http: HttpClient,
    private wsService: WebsocketService
  ) { }

  getAgents(): Observable<Agent[]> {
    return this.http.get<Agent[]>(`${this.apiUrl}/list`);
  }

  registerAgent(agent: {
    name: string;
    email: string;
    password: string;
    role?: 'agent' | 'supervisor' | 'admin';
    maxConcurrentChats?: number;
  }): Observable<Agent> {
    return this.http.post<Agent>(`${this.apiUrl}/register`, agent);
  }

  updateAgentStatus(status: AgentStatus): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.apiUrl}/status`, { status });
  }

  // Update agent status via WebSocket
  updateAgentStatusWs(status: AgentStatus): void {
    this.wsService.send('agent:status', { status });
  }
}