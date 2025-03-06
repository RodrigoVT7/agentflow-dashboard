import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Agent, AgentStatus } from '../../models/agent.model';
import { AgentService } from '../../services/agent.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent implements OnInit {
  currentAgent: Agent | null = null;
  AgentStatus = AgentStatus; // For template access
  
  constructor(
    private authService: AuthService,
    private agentService: AgentService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.authService.currentAgent$.subscribe(agent => {
      this.currentAgent = agent;
      console.log('Navbar: Current agent updated', agent);
    });
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  updateStatus(status: AgentStatus): void {
    console.log('Navbar: updating status to', status);
    
    // Show immediate feedback in UI
    if (this.currentAgent) {
      this.currentAgent = {
        ...this.currentAgent,
        status: status
      };
    }
    
    // First send via WebSocket for immediate response
    this.agentService.updateAgentStatusWs(status);
    
    // Then also update via HTTP for reliability
    this.agentService.updateAgentStatus(status).subscribe({
      next: (response) => {
        console.log('Status update successful:', response);
        // Force a refresh of the current agent data
        this.authService.refreshCurrentAgent().subscribe();
      },
      error: (error) => {
        console.error('Error updating status:', error);
        // Refresh agent data to get the correct status
        this.authService.refreshCurrentAgent().subscribe();
      }
    });
  }

  isAdmin(): boolean {
    return this.authService.isAdmin();
  }

  isSupervisor(): boolean {
    return this.authService.isSupervisor();
  }
}