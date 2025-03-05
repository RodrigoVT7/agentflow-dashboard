import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { QueueItem, QueueSummary } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { environment } from '../../environments/environment';
import { WebsocketService } from './websocket.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class ConversationService {
  private apiUrl = `${environment.apiUrl}/agent`;
  
  private queueSubject = new BehaviorSubject<QueueItem[]>([]);
  public queue$ = this.queueSubject.asObservable();
  
  private activeConversationSubject = new BehaviorSubject<QueueItem | null>(null);
  public activeConversation$ = this.activeConversationSubject.asObservable();

  constructor(
    private http: HttpClient,
    private wsService: WebsocketService,
    private authService: AuthService
  ) {
    // Listen for queue updates from WebSocket
    this.wsService.onMessage<QueueItem[]>('queue:updated').subscribe(
      queue => this.queueSubject.next(queue)
    );
    
    // Listen for conversation updates
    this.wsService.onMessage<QueueItem>('conversation:updated').subscribe(
      conversation => {
        const active = this.activeConversationSubject.value;
        if (active && active.conversationId === conversation.conversationId) {
          this.activeConversationSubject.next(conversation);
        }
        
        // Also update the queue
        this.updateQueueItem(conversation);
      }
    );
    
    // Listen for conversation assignment
    this.wsService.onMessage<{conversation: QueueItem}>('conversation:assigned').subscribe(
      data => {
        this.activeConversationSubject.next(data.conversation);
        this.updateQueueItem(data.conversation);
      }
    );
    
    // Listen for conversation completion
    this.wsService.onMessage<{conversationId: string}>('conversation:completed').subscribe(
      data => {
        const active = this.activeConversationSubject.value;
        if (active && active.conversationId === data.conversationId) {
          this.activeConversationSubject.next(null);
        }
        
        // Remove from queue
        this.removeFromQueue(data.conversationId);
      }
    );
  }

  getQueue(): Observable<QueueSummary[]> {
    return this.http.get<QueueSummary[]>(`${this.apiUrl}/queue`).pipe(
      tap(queue => {
        // We don't update the queueSubject here because it contains less information
        // The WebSocket will provide the full queue information
      })
    );
  }

  getMessages(conversationId: string): Observable<Message[]> {
    return this.http.get<Message[]>(`${this.apiUrl}/messages/${conversationId}`);
  }

  assignAgent(conversationId: string): Observable<{success: boolean}> {
    const agentId = this.authService.getCurrentAgent()?.id;
    if (!agentId) {
      throw new Error('Agent not authenticated');
    }
    
    return this.http.post<{success: boolean}>(`${this.apiUrl}/assign`, {
      conversationId,
      agentId
    });
  }

  sendMessage(conversationId: string, message: string): Observable<{success: boolean, messageId: string}> {
    const agentId = this.authService.getCurrentAgent()?.id;
    if (!agentId) {
      throw new Error('Agent not authenticated');
    }
    
    return this.http.post<{success: boolean, messageId: string}>(`${this.apiUrl}/send`, {
      conversationId,
      agentId,
      message
    });
  }

  completeConversation(conversationId: string): Observable<{success: boolean}> {
    const agentId = this.authService.getCurrentAgent()?.id;
    
    return this.http.post<{success: boolean}>(`${this.apiUrl}/complete`, {
      conversationId,
      agentId
    });
  }

  updatePriority(conversationId: string, priority: number): Observable<{success: boolean}> {
    return this.http.post<{success: boolean}>(`${this.apiUrl}/priority`, {
      conversationId,
      priority
    });
  }

  updateTags(conversationId: string, tags: string[]): Observable<{success: boolean}> {
    return this.http.post<{success: boolean}>(`${this.apiUrl}/tags`, {
      conversationId,
      tags
    });
  }

  // Set a conversation as active in the UI
  setActiveConversation(conversation: QueueItem | null): void {
    this.activeConversationSubject.next(conversation);
  }

  getActiveConversation(): QueueItem | null {
    return this.activeConversationSubject.value;
  }

  // Request conversation via WebSocket
  requestConversation(conversationId: string): void {
    this.wsService.send('conversation:request', { conversationId });
  }

  // Assign agent via WebSocket
  assignAgentWs(conversationId: string): void {
    this.wsService.send('conversation:assign', { conversationId });
  }

  // Send message via WebSocket
  sendMessageWs(conversationId: string, message: string): void {
    this.wsService.send('message:send', { conversationId, message });
  }

  // Complete conversation via WebSocket
  completeConversationWs(conversationId: string): void {
    this.wsService.send('conversation:complete', { conversationId });
  }

  // Request updated queue
  requestQueueUpdate(): void {
    this.wsService.send('queue:request', {});
  }

  // Helper methods to update local queue state
  private updateQueueItem(updatedItem: QueueItem): void {
    const currentQueue = this.queueSubject.value;
    const index = currentQueue.findIndex(item => item.conversationId === updatedItem.conversationId);
    
    if (index !== -1) {
      const updatedQueue = [...currentQueue];
      updatedQueue[index] = updatedItem;
      this.queueSubject.next(updatedQueue);
    } else {
      this.queueSubject.next([...currentQueue, updatedItem]);
    }
  }

  private removeFromQueue(conversationId: string): void {
    const currentQueue = this.queueSubject.value;
    this.queueSubject.next(currentQueue.filter(item => item.conversationId !== conversationId));
  }
}