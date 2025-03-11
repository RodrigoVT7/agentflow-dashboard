// src/app/services/agent.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { tap, catchError, map } from 'rxjs/operators';
import { Agent, AgentStatus } from '../models/agent.model';
import { environment } from '../../environments/environment';
import { WebsocketService } from './websocket.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class AgentService {
  private apiUrl = `${environment.apiUrl}/agent`;
  
  // BehaviorSubject to track all agents
  private agentsSubject = new BehaviorSubject<Agent[]>([]);
  public agents$ = this.agentsSubject.asObservable();

  constructor(
    private http: HttpClient,
    private wsService: WebsocketService,
    private authService: AuthService
  ) {
    // Set up WebSocket event listeners for agent updates
    this.wsService.onMessage<{agents: Agent[]}>('agents:updated').subscribe(data => {
      if (data.agents) {
        this.agentsSubject.next(data.agents);
      }
    });
    
    // Listen for individual agent updates
    this.wsService.onMessage<{agent: Agent}>('agent:updated').subscribe(data => {
      if (data.agent) {
        this.updateAgentInList(data.agent);
      }
    });
    
    // Fetch initial agents when logged in
    this.authService.currentAgent$.subscribe(agent => {
      if (agent) {
        this.loadAgents();
      }
    });
  }

  // Load all agents
  loadAgents(): void {
    this.getAgents().subscribe({
      next: (agents) => {
        this.agentsSubject.next(agents);
      },
      error: (error) => {
        console.error('Error loading agents:', error);
      }
    });
  }

  // Update a single agent in the agents list
  private updateAgentInList(updatedAgent: Agent): void {
    const currentAgents = this.agentsSubject.value;
    const index = currentAgents.findIndex(a => a.id === updatedAgent.id);
    
    if (index !== -1) {
      // Update existing agent
      const newAgents = [...currentAgents];
      newAgents[index] = updatedAgent;
      this.agentsSubject.next(newAgents);
    } else {
      // Add new agent
      this.agentsSubject.next([...currentAgents, updatedAgent]);
    }
  }

  // Get all agents from API
  getAgents(): Observable<Agent[]> {
    return this.http.get<Agent[]>(`${this.apiUrl}/list`).pipe(
      tap(agents => {
        console.log(`Fetched ${agents.length} agents`);
      }),
      catchError(error => {
        console.error('Error fetching agents:', error);
        return throwError(() => error);
      })
    );
  }

  // Register a new agent
  registerAgent(agent: {
    name: string;
    email: string;
    password: string;
    role?: 'agent' | 'supervisor' | 'admin';
    maxConcurrentChats?: number;
  }): Observable<Agent> {
    return this.http.post<Agent>(`${this.apiUrl}/register`, agent).pipe(
      tap(newAgent => {
        // Add to agents list
        const currentAgents = this.agentsSubject.value;
        this.agentsSubject.next([...currentAgents, newAgent]);
      }),
      catchError(error => {
        console.error('Error registering agent:', error);
        return throwError(() => error);
      })
    );
  }

  // Update agent status via HTTP
  updateAgentStatus(status: AgentStatus): Observable<{ success: boolean }> {
    // Get current agent
    const currentAgent = this.authService.getCurrentAgent();
    if (!currentAgent) {
      console.error('Cannot update status: No current agent');
      return throwError(() => new Error('No current agent'));
    }

    // Create optimistic update
    const updatedAgent: Agent = {
      ...currentAgent,
      status: status
    };
    this.authService.updateCurrentAgent(updatedAgent);

    // Send the update to the server
    return this.http.post<{ success: boolean }>(`${this.apiUrl}/status`, { 
      status,
      agentId: currentAgent.id 
    }).pipe(
      tap(response => {
        console.log('Server responded to status update:', response);
      }),
      catchError(error => {
        console.error('Error updating status:', error);
        // Revert optimistic update on error
        this.authService.refreshCurrentAgent().subscribe();
        return throwError(() => error);
      })
    );
  }

  // Send status update via WebSocket (for immediate UI feedback)
  updateAgentStatusWs(status: AgentStatus): void {
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
    
    // Update agent locally for immediate UI feedback
    const updatedAgent: Agent = {
      ...currentAgent,
      status: status
    };
    this.authService.updateCurrentAgent(updatedAgent);
  }
  
  // Get online/available agents
  getOnlineAgents(): Observable<Agent[]> {
    return this.agents$.pipe(
      map(agents => agents.filter(agent => 
        agent.status === AgentStatus.ONLINE || agent.status === AgentStatus.BUSY
      ))
    );
  }
}