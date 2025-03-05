import { Component, OnInit } from '@angular/core';
import { Agent, AgentStatus } from '../../models/agent.model';
import { AgentService } from '../../services/agent.service';
import { CommonModule } from '@angular/common';
import { AgentFormComponent } from '../agent-form/agent-form.component';

@Component({
  selector: 'app-agent-list',
  standalone: true,
  imports: [CommonModule, AgentFormComponent],
  templateUrl: './agent-list.component.html',
  styleUrls: ['./agent-list.component.css']
})
export class AgentListComponent implements OnInit {
  agents: Agent[] = [];
  loading = true;
  error = '';
  showRegisterForm = false;
  
  // For template access
  AgentStatus = AgentStatus;

  constructor(private agentService: AgentService) { }

  ngOnInit(): void {
    this.loadAgents();
  }

  loadAgents(): void {
    this.loading = true;
    this.error = '';
    
    this.agentService.getAgents().subscribe({
      next: (agents) => {
        this.agents = agents;
        this.loading = false;
      },
      error: (error) => {
        this.error = 'Failed to load agents. Please try again.';
        this.loading = false;
        console.error('Error loading agents:', error);
      }
    });
  }

  toggleRegisterForm(): void {
    this.showRegisterForm = !this.showRegisterForm;
  }

  onAgentCreated(agent: Agent): void {
    this.agents = [...this.agents, agent];
    this.showRegisterForm = false;
  }

  formatLastActivity(timestamp: number): string {
    if (!timestamp) return 'Unknown';
    
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 120) return '1 minute ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
    if (seconds < 7200) return '1 hour ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
    
    return new Date(timestamp).toLocaleDateString();
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