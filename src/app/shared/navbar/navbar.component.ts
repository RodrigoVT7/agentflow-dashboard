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
    });
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }

  updateStatus(status: AgentStatus): void {
    this.agentService.updateAgentStatusWs(status);
    
    // Also update via HTTP
    this.agentService.updateAgentStatus(status).subscribe({
      error: (error) => console.error('Error updating status:', error)
    });
  }

  isAdmin(): boolean {
    return this.authService.isAdmin();
  }

  isSupervisor(): boolean {
    return this.authService.isSupervisor();
  }
}