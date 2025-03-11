// src/app/dashboard/dashboard.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ConversationService } from '../services/conversation.service';
import { WebsocketService } from '../services/websocket.service';
import { QueueItem } from '../models/conversation.model';
import { Subscription } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { CommonModule } from '@angular/common';
import { AgentStatusComponent } from './agent-status/agent-status.component';
import { ChatComponent } from '../conversations/chat/chat.component';
import { AgentService } from '../services/agent.service';
import { Agent } from '../models/agent.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ChatComponent, AgentStatusComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  queue: QueueItem[] = [];
  activeConversation: QueueItem | null = null;
  agents: Agent[] = [];
  
  private queueSubscription?: Subscription;
  private activeConversationSubscription?: Subscription;
  private agentsSubscription?: Subscription;
  private websocketStatusSubscription?: Subscription;
  
  isConnected = false;
  loading = true;
  error = '';
  
  constructor(
    private conversationService: ConversationService,
    private wsService: WebsocketService,
    public authService: AuthService, // Made public so it can be accessed from the template
    private agentService: AgentService
  ) { }

  ngOnInit(): void {
    // Subscribe to WebSocket connection status
    this.websocketStatusSubscription = this.wsService.connected$.subscribe(connected => {
      this.isConnected = connected;
      
      if (connected) {
        // Request initial queue data once connected
        this.conversationService.requestQueueUpdate();
      }
    });
    
    // Subscribe to queue updates
    this.queueSubscription = this.conversationService.queue$.subscribe(queue => {
      this.queue = queue;
      this.loading = false;
    });
    
    // Subscribe to active conversation
    this.activeConversationSubscription = this.conversationService.activeConversation$.subscribe(conversation => {
      this.activeConversation = conversation;
    });
    
    // Get agent list
    this.agentsSubscription = this.agentService.getAgents().subscribe({
      next: (agents) => {
        this.agents = agents;
      },
      error: (error) => {
        console.error('Error fetching agents:', error);
      }
    });
    
    // Ensure WebSocket is connected
    if (this.authService.isLoggedIn() && !this.wsService.isConnectedNow()) {
      this.wsService.connect().catch(err => {
        console.error('Error connecting to WebSocket:', err);
        this.error = 'Failed to connect to server. Please refresh the page.';
      });
    }
    
    // Also fetch queue via HTTP for initial data
    this.conversationService.getQueue().subscribe({
      error: (error) => {
        console.error('Error fetching queue:', error);
        this.error = 'Failed to load conversations. Please try again.';
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    if (this.queueSubscription) this.queueSubscription.unsubscribe();
    if (this.activeConversationSubscription) this.activeConversationSubscription.unsubscribe();
    if (this.agentsSubscription) this.agentsSubscription.unsubscribe();
    if (this.websocketStatusSubscription) this.websocketStatusSubscription.unsubscribe();
  }

  selectConversation(conversation: QueueItem): void {
    this.conversationService.setActiveConversation(conversation);
  }

  assignToMe(conversationId: string): void {
    // First assign using HTTP
    this.conversationService.assignAgent(conversationId).subscribe({
      next: () => {
        console.log('Conversation assigned successfully');
      },
      error: (error) => {
        console.error('Error assigning conversation:', error);
        this.error = 'Failed to assign conversation. Please try again.';
      }
    });
  }

  getAssignedToMeCount(): number {
    const currentAgentId = this.authService.getCurrentAgent()?.id;
    if (!currentAgentId) return 0;
    
    return this.queue.filter(item => item.assignedAgent === currentAgentId).length;
  }

  getUnassignedCount(): number {
    return this.queue.filter(item => !item.assignedAgent).length;
  }

  getTotalWaitingTime(): string {
    // Get all conversations in the queue
    const allConversations = this.queue;
    if (allConversations.length === 0) return '0 min';
    
    const now = Date.now();
    let totalWaitTimeMs = 0;
    let validItems = 0;
    
    // Calculate wait time for ALL conversations, not just unassigned ones
    for (const item of allConversations) {
      if (item.startTime && item.startTime > 0) {
        // For assigned conversations, calculate how long they waited before assignment
        if (item.assignedAgent) {
          // Try to safely access assignedTime from metadata if it exists
          const assignedTime = item.metadata && 
                              typeof item.metadata === 'object' && 
                              'assignedTime' in item.metadata ? 
                              (item.metadata as any).assignedTime : null;
          
          if (assignedTime && typeof assignedTime === 'number') {
            // Use the recorded assignment time if available
            totalWaitTimeMs += (assignedTime - item.startTime);
          } else {
            // Otherwise, use current time as an approximation
            totalWaitTimeMs += (now - item.startTime);
          }
        } else {
          // For unassigned conversations, use current time
          totalWaitTimeMs += (now - item.startTime);
        }
        validItems++;
      }
    }
    
    // If no valid items found, return 0
    if (validItems === 0) return '0 min';
    
    // Calculate average wait time in minutes
    const avgWaitTimeMin = Math.floor(totalWaitTimeMs / validItems / 60000);
    
    return `${avgWaitTimeMin} min`;
  }

  // Format timestamp for display
  formatTimestamp(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Method to clear cache and refresh conversations
  clearConversationsCache(): void {
    this.loading = true;
    this.conversationService.clearCachedConversations();
    setTimeout(() => {
      this.loading = false;
    }, 1000);
  }

  // Reconnect WebSocket if disconnected
  reconnectWebSocket(): void {
    if (!this.isConnected) {
      this.wsService.connect().catch(err => {
        console.error('Error reconnecting to WebSocket:', err);
        this.error = 'Failed to reconnect to server. Please refresh the page.';
      });
    }
  }
}