// src/app/dashboard/agent-status/agent-status.component.ts
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { Agent, AgentStatus } from '../../models/agent.model';
import { AgentService } from '../../services/agent.service';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-agent-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './agent-status.component.html',
  styleUrls: ['./agent-status.component.css']
})
export class AgentStatusComponent implements OnInit, OnDestroy {
  @Input() agents: Agent[] = [];
  currentAgent: Agent | null = null;
  
  // For template access
  AgentStatus = AgentStatus;
  
  private agentSubscription?: Subscription;
  private agentsSubscription?: Subscription;
  updating = false;
  errorMessage = '';

  constructor(
    private agentService: AgentService,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    // Subscribe to current agent changes
    this.agentSubscription = this.authService.currentAgent$.subscribe(agent => {
      this.currentAgent = agent;
    });
    
    // Subscribe to agents list changes if not provided via input
    if (!this.agents || this.agents.length === 0) {
      this.agentsSubscription = this.agentService.agents$.subscribe(agents => {
        this.agents = agents.filter(a => a.id !== this.currentAgent?.id); // Exclude current agent
      });
      
      // Initial load
      this.agentService.loadAgents();
    }
  }
  
  ngOnDestroy(): void {
    if (this.agentSubscription) {
      this.agentSubscription.unsubscribe();
    }
    if (this.agentsSubscription) {
      this.agentsSubscription.unsubscribe();
    }
  }

  updateStatus(status: AgentStatus): void {
    if (this.updating) return;
    
    this.updating = true;
    this.errorMessage = '';
    
    // First update via WebSocket for immediate UI feedback
    this.agentService.updateAgentStatusWs(status);
    
    // Then confirm with HTTP request
    this.agentService.updateAgentStatus(status).subscribe({
      next: () => {
        this.updating = false;
      },
      error: (error) => {
        this.updating = false;
        this.errorMessage = 'Failed to update status. Please try again.';
        console.error('Error updating agent status:', error);
      }
    });
  }

  getStatusClass(status: AgentStatus): string {
    switch (status) {
      case AgentStatus.ONLINE:
        return 'bg-success';
      case AgentStatus.BUSY:
        return 'bg-warning';
      case AgentStatus.AWAY:
        return 'bg-secondary';
      case AgentStatus.OFFLINE:
      default:
        return 'bg-danger';
    }
  }
  
  // Get readable status name
  getStatusName(status: AgentStatus): string {
    switch (status) {
      case AgentStatus.ONLINE:
        return 'En linea';
      case AgentStatus.BUSY:
        return 'Ocupado';
      case AgentStatus.AWAY:
        return 'No disponible';
      case AgentStatus.OFFLINE:
      default:
        return 'Desconectado';
    }
  }
  
  // Refresh agent list
  refreshAgents(): void {
    this.agentService.loadAgents();
  }
}