// src/app/services/conversation.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { tap, map, catchError, finalize } from 'rxjs/operators';

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
  
  // Flag to track if we're currently processing a queue update
  private processingQueueUpdate = false;
  
  // Keep a record of recently sent message IDs to prevent duplicates
  private recentMessageIds = new Set<string>();
  
  // Map to track conversations by ID and by phone number
  private conversationsById = new Map<string, QueueItem>();
  private conversationsByPhone = new Map<string, string>(); // phone number -> conversationId

  constructor(
    private http: HttpClient,
    private wsService: WebsocketService,
    private authService: AuthService
  ) {
    // Connect WebSocket on service initialization
    this.wsService.connected$.subscribe(connected => {
      if (connected) {
        this.setupWebSocketHandlers();
      }
    });
    
    // Ensure connection is established if auth token exists
    if (this.authService.isLoggedIn()) {
      this.wsService.connect();
    }
    
    // Reconnect WebSocket when authentication state changes
    this.authService.currentAgent$.subscribe(agent => {
      if (agent) {
        this.wsService.connect();
      }
    });
    
    // Clean up message IDs cache periodically
    setInterval(() => this.cleanupRecentMessageIds(), 60000);
  }

  // Set up WebSocket event handlers
  private setupWebSocketHandlers(): void {
    // Queue updates
    this.wsService.onMessage<QueueItem[]>('queue:updated').subscribe(
      queue => this.handleQueueUpdate(queue)
    );
    
    // Conversation updates
    this.wsService.onMessage<QueueItem>('conversation:updated').subscribe(
      conversation => this.handleConversationUpdate(conversation)
    );
    
    // Conversation assignment
    this.wsService.onMessage<{conversation: QueueItem}>('conversation:assigned').subscribe(
      data => this.handleConversationAssigned(data.conversation)
    );
    
    // Conversation completion
    this.wsService.onMessage<{conversationId: string}>('conversation:completed').subscribe(
      data => this.handleConversationCompleted(data.conversationId)
    );
    
    // New message
    this.wsService.onMessage<{conversationId: string; message: Message}>('message:new').subscribe(
      data => this.handleNewMessage(data.conversationId, data.message)
    );
    
    // New conversation
    this.wsService.onMessage<QueueItem>('conversation:new').subscribe(
      conversation => this.handleNewConversation(conversation)
    );
  }

  // Handle queue update from WebSocket
  private handleQueueUpdate(queue: QueueItem[]): void {
    if (this.processingQueueUpdate) {
      console.log('Already processing a queue update, skipping');
      return;
    }
    
    this.processingQueueUpdate = true;
    
    try {
      console.log('Received queue update with', queue.length, 'conversations');
      
      // Clear current maps (we'll rebuild them from the updated queue)
      this.conversationsById.clear();
      this.conversationsByPhone.clear();
      
      // Process and validate incoming conversations
      const processedQueue = queue
        .map(item => this.validateQueueItem(item))
        .filter(item => !!item.conversationId);
      
      // Build our lookup maps
      processedQueue.forEach(item => {
        this.conversationsById.set(item.conversationId, item);
        if (item.from) {
          this.conversationsByPhone.set(item.from, item.conversationId);
        }
      });
      
      // Update the queue
      this.queueSubject.next(processedQueue);
      
      // Update active conversation if it's in the updated queue
      const active = this.activeConversationSubject.value;
      if (active) {
        const updatedActive = this.conversationsById.get(active.conversationId);
        if (updatedActive) {
          this.activeConversationSubject.next(updatedActive);
        }
      }
    } finally {
      this.processingQueueUpdate = false;
    }
  }

  // Handle conversation update from WebSocket
  private handleConversationUpdate(conversation: QueueItem): void {
    const validatedConversation = this.validateQueueItem(conversation);
    
    // Update in our maps
    this.conversationsById.set(validatedConversation.conversationId, validatedConversation);
    if (validatedConversation.from) {
      this.conversationsByPhone.set(validatedConversation.from, validatedConversation.conversationId);
    }
    
    // Update active conversation if needed
    const active = this.activeConversationSubject.value;
    if (active && active.conversationId === validatedConversation.conversationId) {
      this.activeConversationSubject.next(validatedConversation);
    }
    
    // Update queue
    const currentQueue = this.queueSubject.value;
    const updatedQueue = currentQueue.map(item => 
      item.conversationId === validatedConversation.conversationId ? validatedConversation : item
    );
    this.queueSubject.next(updatedQueue);
  }

  // Handle conversation assignment from WebSocket
  private handleConversationAssigned(conversation: QueueItem): void {
    const validatedConversation = this.validateQueueItem(conversation);
    
    // Update in our maps
    this.conversationsById.set(validatedConversation.conversationId, validatedConversation);
    if (validatedConversation.from) {
      this.conversationsByPhone.set(validatedConversation.from, validatedConversation.conversationId);
    }
    
    // Update active conversation
    this.activeConversationSubject.next(validatedConversation);
    
    // Update queue
    const currentQueue = this.queueSubject.value;
    const updatedQueue = currentQueue.map(item => 
      item.conversationId === validatedConversation.conversationId ? validatedConversation : item
    );
    this.queueSubject.next(updatedQueue);
  }

  // Handle conversation completion from WebSocket
  private handleConversationCompleted(conversationId: string): void {
    // Check if this was the active conversation
    const active = this.activeConversationSubject.value;
    if (active && active.conversationId === conversationId) {
      this.activeConversationSubject.next(null);
    }
    
    // Get conversation from map for cleanup
    const conversation = this.conversationsById.get(conversationId);
    if (conversation && conversation.from) {
      this.conversationsByPhone.delete(conversation.from);
    }
    
    // Remove from our map
    this.conversationsById.delete(conversationId);
    
    // Remove from queue
    const currentQueue = this.queueSubject.value;
    const updatedQueue = currentQueue.filter(item => item.conversationId !== conversationId);
    this.queueSubject.next(updatedQueue);
  }

  // Handle new message from WebSocket
  private handleNewMessage(conversationId: string, message: Message): void {
    // Skip if we've already processed this message
    if (message.id && this.recentMessageIds.has(message.id)) {
      console.log('Received duplicate message, skipping:', message.id);
      return;
    }
    
    // Add to recent messages set
    if (message.id) {
      this.recentMessageIds.add(message.id);
    }
    
    // Update active conversation if it's the one receiving the message
    const active = this.activeConversationSubject.value;
    if (active && active.conversationId === conversationId) {
      const updatedConversation = {...active};
      updatedConversation.messages = [...updatedConversation.messages, message];
      this.activeConversationSubject.next(updatedConversation);
    }
    
    // Update conversation in our map
    const conversation = this.conversationsById.get(conversationId);
    if (conversation) {
      const updatedConversation = {...conversation};
      updatedConversation.messages = [...(updatedConversation.messages || []), message];
      this.conversationsById.set(conversationId, updatedConversation);
      
      // Update queue
      const currentQueue = this.queueSubject.value;
      const updatedQueue = currentQueue.map(item => 
        item.conversationId === conversationId ? updatedConversation : item
      );
      this.queueSubject.next(updatedQueue);
    }
  }

  // Handle new conversation from WebSocket
  private handleNewConversation(newConversation: QueueItem): void {
    // Validate and normalize the conversation
    const validatedConversation = this.validateQueueItem(newConversation);
    
    // Check if we already have this conversation
    if (this.conversationsById.has(validatedConversation.conversationId)) {
      console.log('Conversation already exists, updating:', validatedConversation.conversationId);
      this.handleConversationUpdate(validatedConversation);
      return;
    }
    
    // Check if we have a conversation for this phone number
    if (validatedConversation.from && this.conversationsByPhone.has(validatedConversation.from)) {
      const existingId = this.conversationsByPhone.get(validatedConversation.from);
      console.log('Phone number already has a conversation:', existingId);
      // We won't add a duplicate for the same phone number
      return;
    }
    
    // Add to our maps
    this.conversationsById.set(validatedConversation.conversationId, validatedConversation);
    if (validatedConversation.from) {
      this.conversationsByPhone.set(validatedConversation.from, validatedConversation.conversationId);
    }
    
    // Add to queue
    const currentQueue = this.queueSubject.value;
    this.queueSubject.next([...currentQueue, validatedConversation]);
  }

  // Clean up recently seen message IDs to prevent memory leaks
  private cleanupRecentMessageIds(): void {
    if (this.recentMessageIds.size > 100) {
      console.log('Cleaning up recent message IDs cache');
      this.recentMessageIds.clear();
    }
  }

  // Validate and normalize a queue item
  private validateQueueItem(item: QueueItem): QueueItem {
    return {
      ...item,
      conversationId: item.conversationId || item.id || '',
      startTime: item.startTime || Date.now(),
      messages: (item.messages || []).filter(m => !!m && !!m.text && !!m.from),
      priority: item.priority || 2,
      tags: item.tags || [],
      metadata: item.metadata || {}
    };
  }

  // Get queue from HTTP API
  getQueue(): Observable<QueueSummary[]> {
    return this.http.get<QueueSummary[]>(`${this.apiUrl}/queue`).pipe(
      tap(queue => {
        console.log('Received conversations from API:', queue);
      }),
      catchError(error => {
        console.error('Error fetching queue:', error);
        return of([]);
      })
    );
  }

  // Get messages for a conversation from HTTP API
  getMessages(conversationId: string): Observable<Message[]> {
    return this.http.get<Message[]>(`${this.apiUrl}/messages/${conversationId}`).pipe(
      map(messages => messages.filter(m => !!m && !!m.text && !!m.from)),
      catchError(error => {
        console.error(`Error fetching messages for conversation ${conversationId}:`, error);
        return of([]);
      })
    );
  }

  // Assign agent to conversation via HTTP
  assignAgent(conversationId: string): Observable<{success: boolean}> {
    const agentId = this.authService.getCurrentAgent()?.id;
    if (!agentId) {
      return throwError(() => new Error('Agent not authenticated'));
    }
    
    // First notify via WebSocket for immediate response
    this.wsService.send('conversation:assign', { conversationId });
    
    // Then use HTTP for confirmation and reliability
    return this.http.post<{success: boolean}>(`${this.apiUrl}/assign`, {
      conversationId,
      agentId
    }).pipe(
      catchError(error => {
        console.error(`Error assigning agent to conversation ${conversationId}:`, error);
        return throwError(() => error);
      })
    );
  }

  // Send message via HTTP
  sendMessage(conversationId: string, message: string): Observable<{success: boolean, messageId: string}> {
    const agentId = this.authService.getCurrentAgent()?.id;
    if (!agentId) {
      return throwError(() => new Error('Agent not authenticated'));
    }
    
    // Skip empty messages
    if (!message || !message.trim()) {
      return throwError(() => new Error('Cannot send empty message'));
    }
    
    return this.http.post<{success: boolean, messageId: string}>(`${this.apiUrl}/send`, {
      conversationId,
      agentId,
      message: message.trim()
    }).pipe(
      catchError(error => {
        console.error(`Error sending message to conversation ${conversationId}:`, error);
        return throwError(() => error);
      })
    );
  }

  // Complete conversation via HTTP
  completeConversation(conversationId: string): Observable<{success: boolean}> {
    const agentId = this.authService.getCurrentAgent()?.id;
    
    // First notify via WebSocket for immediate response
    this.wsService.send('conversation:complete', { conversationId });
    
    // Then use HTTP for confirmation and reliability
    return this.http.post<{success: boolean}>(`${this.apiUrl}/complete`, {
      conversationId,
      agentId
    }).pipe(
      catchError(error => {
        console.error(`Error completing conversation ${conversationId}:`, error);
        return throwError(() => error);
      })
    );
  }

  // Update conversation priority
  updatePriority(conversationId: string, priority: number): Observable<{success: boolean}> {
    return this.http.post<{success: boolean}>(`${this.apiUrl}/priority`, {
      conversationId,
      priority
    }).pipe(
      catchError(error => {
        console.error(`Error updating priority for conversation ${conversationId}:`, error);
        return throwError(() => error);
      })
    );
  }

  // Update conversation tags
  updateTags(conversationId: string, tags: string[]): Observable<{success: boolean}> {
    return this.http.post<{success: boolean}>(`${this.apiUrl}/tags`, {
      conversationId,
      tags
    }).pipe(
      catchError(error => {
        console.error(`Error updating tags for conversation ${conversationId}:`, error);
        return throwError(() => error);
      })
    );
  }

  // Set active conversation in UI
  setActiveConversation(conversation: QueueItem | null): void {
    if (conversation) {
      this.activeConversationSubject.next(this.validateQueueItem(conversation));
    } else {
      this.activeConversationSubject.next(null);
    }
  }

  // Get active conversation
  getActiveConversation(): QueueItem | null {
    return this.activeConversationSubject.value;
  }

  // Request conversation details via WebSocket
  requestConversation(conversationId: string): void {
    this.wsService.send('conversation:request', { conversationId });
  }

  // Request queue update via WebSocket
  requestQueueUpdate(): void {
    this.wsService.send('queue:request', {});
  }

  // Refresh a specific conversation
  refreshConversation(conversationId: string): void {
    // First check if we have this conversation
    if (!this.conversationsById.has(conversationId)) {
      console.log(`Conversation ${conversationId} not found, requesting it`);
      this.requestConversation(conversationId);
      return;
    }
    
    // Get updated conversation data from server
    this.http.get<QueueItem>(`${this.apiUrl}/conversation/${conversationId}`).subscribe({
      next: (updatedConversation) => {
        const validatedConversation = this.validateQueueItem(updatedConversation);
        this.handleConversationUpdate(validatedConversation);
        console.log(`Refreshed conversation data: ${conversationId}`);
      },
      error: (error) => {
        console.error(`Error refreshing conversation ${conversationId}:`, error);
      }
    });
  }

  // Clear cached conversations
  clearCachedConversations(): void {
    console.log('Clearing conversation cache');
    this.conversationsById.clear();
    this.conversationsByPhone.clear();
    this.recentMessageIds.clear();
    this.queueSubject.next([]);
    this.activeConversationSubject.next(null);
    
    // Request fresh data
    this.requestQueueUpdate();
  }

  /**
 * Obtener conversaciones completadas
 */
getCompletedConversations(): Observable<QueueItem[]> {
  return this.http.get<QueueItem[]>(`${this.apiUrl}/completed`).pipe(
    map(conversations => {
      // Validar y normalizar los objetos QueueItem
      return conversations.map(item => this.validateQueueItem(item));
    }),
    tap(conversations => {
      console.log('Fetched completed conversations:', conversations.length);
    }),
    catchError(error => {
      console.error('Error fetching completed conversations:', error);
      return of([]); // Return empty array on error
    })
  );
}

}