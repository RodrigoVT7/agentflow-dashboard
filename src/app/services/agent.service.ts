import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Agent, AgentStatus } from '../models/agent.model';
import { environment } from '../../environments/environment';
import { WebsocketService } from './websocket.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class AgentService {
  private apiUrl = `${environment.apiUrl}/agent`;

  constructor(
    private http: HttpClient,
    private wsService: WebsocketService,
    private authService: AuthService
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
    // Log the status update attempt
    console.log('Updating agent status to:', status);
    
    // Get current agent
    const currentAgent = this.authService.getCurrentAgent();
    if (!currentAgent) {
      console.error('Cannot update status: No current agent');
      return throwError(() => new Error('No current agent'));
    }

    // First, optimistically update the agent locally through the auth service
    const updatedAgent: Agent = {
      ...currentAgent,
      status: status
    };
    this.authService.updateCurrentAgent(updatedAgent);

    // Then send the update to the server
    return this.http.post<{ success: boolean }>(`${this.apiUrl}/status`, { 
      status,
      agentId: currentAgent.id 
    }).pipe(
      tap(response => {
        console.log('Server responded to status update:', response);
        if (response.success) {
          // Confirm the local update with the server response
          this.authService.updateCurrentAgent(updatedAgent);
        }
      }),
      catchError(error => {
        console.error('Error updating status:', error);
        // Revert local change on error
        this.authService.refreshCurrentAgent();
        return throwError(() => error);
      })
    );
  }

  // Update agent status via WebSocket
  updateAgentStatusWs(status: AgentStatus): void {
    console.log('Sending WebSocket status update:', status);
    
    // Get current agent
    const currentAgent = this.authService.getCurrentAgent();
    if (!currentAgent) {
      console.error('Cannot update status via WebSocket: No current agent');
      return;
    }
    
    // Send via WebSocket
    this.wsService.send('agent:status', { 
      status,
      agentId: currentAgent.id 
    });
    
    // Also update local agent state immediately for better UX
    const updatedAgent: Agent = {
      ...currentAgent,
      status: status
    };
    this.authService.updateCurrentAgent(updatedAgent);
  }
}