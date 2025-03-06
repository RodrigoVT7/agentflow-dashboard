import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap, map, take } from 'rxjs/operators';

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
  
  // No usaremos esto para conversaciones completadas
  private readonly COMPLETED_CONVERSATIONS_KEY = 'completed_conversations';
  
  // Flag to track if we're currently processing a queue update
  private processingQueueUpdate = false;

  constructor(
    private http: HttpClient,
    private wsService: WebsocketService,
    private authService: AuthService
  ) {
    // Listen for queue updates from WebSocket
    this.wsService.onMessage<QueueItem[]>('queue:updated').subscribe(
      queue => {
        if (this.processingQueueUpdate) {
          console.log('Already processing a queue update, skipping');
          return;
        }
        
        this.processingQueueUpdate = true;
        
        try {
          // No filtramos por conversaciones completadas para evitar perder conversaciones nuevas
          // Solo validamos y normalizamos cada elemento
          const filteredQueue = queue
            .map(item => this.validateQueueItem(item))
            .filter(item => !!item.conversationId); // Solo filtrar elementos sin ID
            
          this.queueSubject.next(filteredQueue);
        } finally {
          this.processingQueueUpdate = false;
        }
      }
    );
    
    // Listen for conversation updates
    this.wsService.onMessage<QueueItem>('conversation:updated').subscribe(
      conversation => {
        const validatedConversation = this.validateQueueItem(conversation);
        
        const active = this.activeConversationSubject.value;
        if (active && active.conversationId === validatedConversation.conversationId) {
          this.activeConversationSubject.next(validatedConversation);
        }
        
        // Also update the queue
        this.updateQueueItem(validatedConversation);
      }
    );
    
    // Listen for conversation assignment
    this.wsService.onMessage<{conversation: QueueItem}>('conversation:assigned').subscribe(
      data => {
        const validatedConversation = this.validateQueueItem(data.conversation);
        
        this.activeConversationSubject.next(validatedConversation);
        this.updateQueueItem(validatedConversation);
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
        
        // IMPORTANTE: NO almacenamos ID de conversación completada
        // para permitir que nuevas conversaciones del mismo número aparezcan
        // this.storeCompletedConversationId(data.conversationId);
      }
    );
    
    // Setup listeners for messages and new conversations
    this.setupMessageListener();
    this.setupNewConversationListener();
  }

  // Validate and normalize a queue item to ensure all required fields exist
  private validateQueueItem(item: QueueItem): QueueItem {
    return {
      ...item,
      conversationId: item.conversationId || item.id || '', // Usar id como backup para conversationId
      startTime: item.startTime || Date.now(),
      messages: (item.messages || []).filter(m => !!m && !!m.text && !!m.from),
      priority: item.priority || 2,
      tags: item.tags || [],
      metadata: item.metadata || {}
    };
  }
  
  private setupMessageListener(): void {
    this.wsService.onMessage<{conversationId: string; message: Message}>('message:new').subscribe(
      data => {
        const { conversationId, message } = data;
        
        // Skip empty or invalid messages
        if (!message || !message.text || !message.from) {
          console.warn('Received empty or invalid message, skipping:', message);
          return;
        }
        
        // Update active conversation if it's the one receiving the message
        const active = this.activeConversationSubject.value;
        if (active && active.conversationId === conversationId) {
          const updatedConversation = {...active};
          updatedConversation.messages = [...updatedConversation.messages, message];
          this.activeConversationSubject.next(updatedConversation);
        }
        
        // Update queue item
        this.updateQueueItemMessages(conversationId, message);
      }
    );
  }
  
  private setupNewConversationListener(): void {
    this.wsService.onMessage<QueueItem>('conversation:new').subscribe(
      newConversation => {
        // Skip invalid conversations
        if (!newConversation || (!newConversation.conversationId && !newConversation.id)) {
          console.warn('Received invalid new conversation, skipping');
          return;
        }
        
        // Validate the conversation
        const validatedConversation = this.validateQueueItem(newConversation);
        
        // Don't add empty conversations
        if (!validatedConversation.messages || validatedConversation.messages.length === 0) {
          console.warn('Skipping empty new conversation');
          return;
        }
        
        // Check if this conversation is already in the queue
        const existingIndex = this.findQueueItemIndexById(validatedConversation.conversationId);
        if (existingIndex >= 0) {
          console.log('Conversation already in queue, updating instead of adding new:', validatedConversation.conversationId);
          this.updateQueueItem(validatedConversation);
          return;
        }
        
        // Add to queue
        console.log('Adding new conversation to queue:', validatedConversation.conversationId);
        const currentQueue = this.queueSubject.value;
        this.queueSubject.next([...currentQueue, validatedConversation]);
      }
    );
  }

  // No usamos este método para permitir nuevas conversaciones desde el mismo número
  private storeCompletedConversationId(conversationId: string): void {
    // Dejamos este método vacío para que no almacene nada
    console.log('Conversación completada (no almacenada):', conversationId);
  }

  private getCompletedConversationIds(): string[] {
    // Siempre devolvemos una lista vacía para que no se filtren conversaciones
    return [];
  }

  getQueue(): Observable<QueueSummary[]> {
    return this.http.get<QueueSummary[]>(`${this.apiUrl}/queue`).pipe(
      tap(queue => {
        console.log('Recibidas conversaciones del API:', queue);
      })
    );
  }

  getMessages(conversationId: string): Observable<Message[]> {
    return this.http.get<Message[]>(`${this.apiUrl}/messages/${conversationId}`).pipe(
      map(messages => messages.filter(m => !!m && !!m.text && !!m.from)) // Filter out invalid messages
    );
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
    
    // Skip empty messages
    if (!message || !message.trim()) {
      throw new Error('Cannot send empty message');
    }
    
    return this.http.post<{success: boolean, messageId: string}>(`${this.apiUrl}/send`, {
      conversationId,
      agentId,
      message: message.trim()
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
    if (conversation) {
      this.activeConversationSubject.next(this.validateQueueItem(conversation));
    } else {
      this.activeConversationSubject.next(null);
    }
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
    // Skip empty messages
    if (!message || !message.trim()) {
      console.warn('Attempted to send empty message, skipping');
      return;
    }
    
    this.wsService.send('message:send', { conversationId, message: message.trim() });
  }

  // Complete conversation via WebSocket
  completeConversationWs(conversationId: string): void {
    // NO almacenamos IDs de conversación completada para evitar problemas con nuevas conversaciones
    
    // Enviar el mensaje WebSocket normal
    this.wsService.send('conversation:complete', { conversationId });
  }

  // Request updated queue
  requestQueueUpdate(): void {
    this.wsService.send('queue:request', {});
  }
  
  // Find a queue item by ID
  findQueueItemById(conversationId: string): QueueItem | undefined {
    return this.queueSubject.value.find(item => 
      item.conversationId === conversationId || item.id === conversationId
    );
  }
  
  // Find a queue item's index by ID
  findQueueItemIndexById(conversationId: string): number {
    return this.queueSubject.value.findIndex(item => 
      item.conversationId === conversationId || item.id === conversationId
    );
  }

  // Helper methods to update local queue state
  private updateQueueItem(updatedItem: QueueItem): void {
    const validatedItem = this.validateQueueItem(updatedItem);
    const currentQueue = this.queueSubject.value;
    const index = currentQueue.findIndex(item => 
      item.conversationId === validatedItem.conversationId || 
      item.id === validatedItem.conversationId ||
      item.conversationId === validatedItem.id || 
      item.id === validatedItem.id
    );
    
    if (index !== -1) {
      const updatedQueue = [...currentQueue];
      updatedQueue[index] = validatedItem;
      this.queueSubject.next(updatedQueue);
    } else {
      // Always add new conversations to the queue
      this.queueSubject.next([...currentQueue, validatedItem]);
    }
  }

  private updateQueueItemMessages(conversationId: string, newMessage: Message): void {
    // Skip empty or invalid messages
    if (!newMessage || !newMessage.text || !newMessage.from) {
      return;
    }
    
    const currentQueue = this.queueSubject.value;
    const index = currentQueue.findIndex(item => 
      item.conversationId === conversationId || item.id === conversationId
    );
    
    if (index !== -1) {
      const updatedQueue = [...currentQueue];
      const updatedItem = {...updatedQueue[index]};
      updatedItem.messages = [...(updatedItem.messages || []), newMessage];
      updatedQueue[index] = updatedItem;
      this.queueSubject.next(updatedQueue);
    }
  }

  private removeFromQueue(conversationId: string): void {
    const currentQueue = this.queueSubject.value;
    this.queueSubject.next(currentQueue.filter(item => 
      item.conversationId !== conversationId && item.id !== conversationId
    ));
  }

  // Método para limpiar el localStorage y reiniciar el estado
  clearCachedConversations(): void {
    try {
      localStorage.removeItem(this.COMPLETED_CONVERSATIONS_KEY);
      localStorage.removeItem('processed_conversations');
      localStorage.removeItem('processed_phone_numbers');
      console.log('Caché de conversaciones limpiado');
    } catch (error) {
      console.error('Error limpiando caché:', error);
    }
  }
}