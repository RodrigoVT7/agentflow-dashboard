import { Component, OnInit, OnDestroy } from '@angular/core';
import { ConversationService } from '../services/conversation.service';
import { WebsocketService } from '../services/websocket.service';
import { QueueItem } from '../models/conversation.model';
import { Subscription } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { CommonModule } from '@angular/common';
import { QueuePanelComponent } from './queue-panel/queue-panel.component';
import { AgentStatusComponent } from './agent-status/agent-status.component';
import { ChatComponent } from '../conversations/chat/chat.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ChatComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  queue: QueueItem[] = [];
  activeConversation: QueueItem | null = null;
  private queueSubscription?: Subscription;
  private activeConversationSubscription?: Subscription;
  
  constructor(
    private conversationService: ConversationService,
    private wsService: WebsocketService,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    // Connect WebSocket
    this.wsService.connect();
    
    // Subscribe to queue updates
    this.queueSubscription = this.conversationService.queue$.subscribe(queue => {
      // Ensure each queue item has a messages array
      this.queue = queue.map(item => ({
        ...item,
        messages: item.messages || []
      }));
    });
    
    // Subscribe to active conversation
    this.activeConversationSubscription = this.conversationService.activeConversation$.subscribe(conversation => {
      if (conversation) {
        // Ensure the active conversation has a messages array
        this.activeConversation = {
          ...conversation,
          messages: conversation.messages || []
        };
      } else {
        this.activeConversation = null;
      }
    });
    
    // Request initial queue data
    this.conversationService.requestQueueUpdate();
    
    // Also fetch via HTTP for initial data
    this.conversationService.getQueue().subscribe();
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    if (this.queueSubscription) {
      this.queueSubscription.unsubscribe();
    }
    if (this.activeConversationSubscription) {
      this.activeConversationSubscription.unsubscribe();
    }
  }

  selectConversation(conversation: QueueItem): void {
    // Ensure the conversation we're selecting has a messages array
    const conversationWithMessages = {
      ...conversation,
      messages: conversation.messages || []
    };
    this.conversationService.setActiveConversation(conversationWithMessages);
  }

  assignToMe(conversationId: string): void {
    // First request the conversation via WebSocket
    this.conversationService.requestConversation(conversationId);
    
    // Then assign via WebSocket
    this.conversationService.assignAgentWs(conversationId);
    
    // Also call HTTP endpoint
    this.conversationService.assignAgent(conversationId).subscribe();
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

  // Método para limpiar caché y refrescar conversaciones
  clearConversationsCache(): void {
    this.conversationService.clearCachedConversations();
    alert('Caché de conversaciones limpiado. Se refrescarán las conversaciones.');
    this.conversationService.requestQueueUpdate();
  }
}