import { Component, Input, OnInit } from '@angular/core';
import { Agent, AgentStatus } from '../../models/agent.model';
import { AgentService } from '../../services/agent.service';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-agent-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './agent-status.component.html',
  styleUrls: ['./agent-status.component.css']
})
export class AgentStatusComponent implements OnInit {
  @Input() agents: Agent[] = [];
  currentAgent: Agent | null = null;
  
  // For template access
  AgentStatus = AgentStatus;

  constructor(
    private agentService: AgentService,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    this.authService.currentAgent$.subscribe(agent => {
      this.currentAgent = agent;
    });
  }

  updateStatus(status: AgentStatus): void {
    this.agentService.updateAgentStatusWs(status);
    
    // Also update via HTTP
    this.agentService.updateAgentStatus(status).subscribe({
      error: (error) => console.error('Error updating status:', error)
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
}