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
  showEditForm = false;
  selectedAgent: Agent | null = null;
  
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
        this.error = 'Fallo al cargar agentes, intenta de nuevo.';
        this.loading = false;
        console.error('Error loading agents:', error);
      }
    });
  }

  toggleRegisterForm(): void {
    this.showRegisterForm = !this.showRegisterForm;
    this.showEditForm = false; // Close edit form if open
    this.selectedAgent = null; // Clear selected agent
  }

  onAgentCreated(agent: Agent): void {
    this.agents = [...this.agents, agent];
    this.showRegisterForm = false;
  }

  editAgent(agent: Agent): void {
    this.selectedAgent = { ...agent }; // Make a copy to avoid modifying the original directly
    this.showEditForm = true;
    this.showRegisterForm = false;
  }

  onAgentUpdated(updatedAgent: Agent): void {
    // Update the agent in the list
    this.agents = this.agents.map(agent => 
      agent.id === updatedAgent.id ? updatedAgent : agent
    );
    this.showEditForm = false;
    this.selectedAgent = null;
  }

  deleteAgent(agent: Agent): void {
    if (confirm(`¿Esta seguro que desea eliminar al agente ${agent.name}?`)) {
      this.agentService.deleteAgent(agent.id).subscribe({
        next: () => {
          this.agents = this.agents.filter(a => a.id !== agent.id);
        },
        error: (error) => {
          this.error = 'Fallo al eliminara gente, intenta de nuevo.';
          console.error('Error deleting agent:', error);
        }
      });
    }
  }

  formatLastActivity(timestamp: number): string {
    if (!timestamp) return 'Unknown';
    
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'Justo ahora';
    if (seconds < 120) return '1 minuto';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
    if (seconds < 7200) return '1 hora';
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