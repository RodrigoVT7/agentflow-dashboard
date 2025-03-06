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
  
  // Keep a record of recently sent message IDs to prevent duplicate sends and processing
  private recentMessageIds = new Set<string>();

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
          console.log('Received queue update with', queue.length, 'conversations');
          
          // Get current queue to maintain state for existing conversations
          const currentQueue = this.queueSubject.value;
          
          // Validate and normalize all incoming conversations
          const validatedQueue = queue.map(item => this.validateQueueItem(item))
                                    .filter(item => !!item.conversationId);
          
          // Create a map for quick lookup of existing conversations by ID
          const existingConversations = new Map<string, QueueItem>();
          currentQueue.forEach(item => {
            if (item.conversationId) {
              existingConversations.set(item.conversationId, item);
            }
            if (item.id && item.id !== item.conversationId) {
              existingConversations.set(item.id, item);
            }
          });
          
          // Process each incoming conversation
          const processedQueue: QueueItem[] = [];
          
          validatedQueue.forEach(newItem => {
            // Check if this conversation already exists in our current queue
            const existingItem = existingConversations.get(newItem.conversationId) || 
                                existingConversations.get(newItem.id || '');
            
            if (existingItem) {
              // This conversation exists - preserve assignment if it has one
              if (existingItem.assignedAgent) {
                processedQueue.push({
                  ...newItem,
                  assignedAgent: existingItem.assignedAgent
                });
              } else {
                processedQueue.push(newItem);
              }
            } else {
              // This is a new conversation
              processedQueue.push(newItem);
            }
          });
          
          // Make sure we don't lose conversations assigned to current agent
          const currentAgent = this.authService.getCurrentAgent();
          if (currentAgent) {
            const processedIds = new Set(processedQueue.map(item => item.conversationId));
            
            // Find conversations assigned to me that aren't in the processed queue
            const missingAssigned = currentQueue.filter(item => 
              item.assignedAgent === currentAgent.id && 
              !processedIds.has(item.conversationId)
            );
            
            // Add any missing assigned conversations
            if (missingAssigned.length > 0) {
              console.log('Adding', missingAssigned.length, 'missing assigned conversations to queue');
              processedQueue.push(...missingAssigned);
            }
          }
          
          // Update the queue
          console.log('Processed queue has', processedQueue.length, 'conversations');
          this.queueSubject.next(processedQueue);
          
          // Run deduplication after a short delay
          setTimeout(() => this.deduplicateQueue(), 500);
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
        
        // Also update the queue - preserving assignment if it exists
        this.updateQueueItem(validatedConversation, true);
      }
    );
    
    // Listen for conversation assignment
    this.wsService.onMessage<{conversation: QueueItem}>('conversation:assigned').subscribe(
      data => {
        const validatedConversation = this.validateQueueItem(data.conversation);
        
        this.activeConversationSubject.next(validatedConversation);
        // Update in queue - ensure assignment is preserved
        this.updateQueueItem(validatedConversation, true);
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
    
    // Setup listeners for messages and new conversations
    this.setupMessageListener();
    this.setupNewConversationListener();
    
    // Periodically clean up duplicates
    setInterval(() => this.deduplicateQueue(), 30000); // Every 30 seconds
    
    // Periodically clean old message IDs
    setInterval(() => this.cleanupRecentMessageIds(), 60000); // Every minute
  }

  // Clean up old message IDs to prevent memory leaks
  private cleanupRecentMessageIds(): void {
    if (this.recentMessageIds.size > 100) {
      console.log('Cleaning up recent message IDs cache');
      this.recentMessageIds.clear();
    }
  }

  // Method to refresh a specific conversation's data
  refreshConversation(conversationId: string): void {
    // First check if this conversation exists in our queue
    const currentQueue = this.queueSubject.value;
    const existingIndex = currentQueue.findIndex(item => 
      item.conversationId === conversationId || item.id === conversationId
    );
    
    if (existingIndex === -1) {
      console.log('Conversation not found in queue, requesting it:', conversationId);
      this.requestConversation(conversationId);
      return;
    }
    
    // Get updated conversation data from the server
    this.http.get<QueueItem>(`${this.apiUrl}/conversation/${conversationId}`).subscribe({
      next: (updatedConversation) => {
        const validatedConversation = this.validateQueueItem(updatedConversation);
        
        // Update in our queue
        const updatedQueue = [...currentQueue];
        updatedQueue[existingIndex] = {
          ...validatedConversation,
          // Preserve the existing ID to prevent issues
          id: currentQueue[existingIndex].id,
          conversationId: currentQueue[existingIndex].conversationId
        };
        
        // Update the queue
        this.queueSubject.next(updatedQueue);
        
        // Also update active conversation if needed
        const active = this.activeConversationSubject.value;
        if (active && active.conversationId === conversationId) {
          this.activeConversationSubject.next(updatedQueue[existingIndex]);
        }
        
        console.log('Refreshed conversation data:', conversationId);
      },
      error: (error) => {
        console.error('Error refreshing conversation:', error);
      }
    });
  }

  // Helper function to determine if two conversations are the same
  private areConversationsSame(conv1: QueueItem, conv2: QueueItem): boolean {
    // Check direct ID matches
    if ((conv1.id && conv2.id && conv1.id === conv2.id) ||
        (conv1.conversationId && conv2.conversationId && conv1.conversationId === conv2.conversationId)) {
      return true;
    }
    
    // Check cross-matches
    if ((conv1.id && conv2.conversationId && conv1.id === conv2.conversationId) ||
        (conv1.conversationId && conv2.id && conv1.conversationId === conv2.id)) {
      return true;
    }
    
    // If both have phone numbers and they match
    if (conv1.phone_number_id && conv2.phone_number_id && 
        conv1.phone_number_id === conv2.phone_number_id) {
      return true;
    }
    
    // If both have 'from' (phone numbers) and they match exactly
    if (conv1.from && conv2.from && conv1.from === conv2.from) {
      // If they have different assignments, consider them different conversations
      if (conv1.assignedAgent !== conv2.assignedAgent && 
         (conv1.assignedAgent || conv2.assignedAgent)) {  // Only if at least one is assigned
        return false;
      }
      
      // Only consider a match if they have the same number of messages or similar timestamps
      const hasSimilarMessageCount = conv1.messages && conv2.messages && 
                                 Math.abs(conv1.messages.length - conv2.messages.length) < 3;
      const hasSimilarTimestamp = conv1.startTime && conv2.startTime && 
                               Math.abs(conv1.startTime - conv2.startTime) < 60000; // Within a minute
                              
      return Boolean(hasSimilarMessageCount) || Boolean(hasSimilarTimestamp);
    }
    
    return false;
  }

  // Deduplicate queue periodically or after updates
  private deduplicateQueue(): void {
    // Don't run deduplication if we're processing a queue update
    if (this.processingQueueUpdate) {
      return;
    }
    
    const currentQueue = this.queueSubject.value;
    if (currentQueue.length <= 1) return; // Nothing to deduplicate
    
    // Get current agent for assignment checking
    const currentAgent = this.authService.getCurrentAgent();
    
    // Start with assigned conversations
    const deduplicatedQueue: QueueItem[] = [];
    const processedFromValues = new Set<string>();
    const processedIds = new Set<string>();
    
    // First process assigned conversations (highest priority)
    currentQueue.forEach(item => {
      if (item.assignedAgent) {
        // This conversation is assigned
        if (!processedIds.has(item.conversationId)) {
          deduplicatedQueue.push(item);
          processedIds.add(item.conversationId);
          if (item.from) processedFromValues.add(item.from);
        }
      }
    });
    
    // Then process conversations with actual messages
    currentQueue.forEach(item => {
      if (!item.assignedAgent && item.messages && item.messages.length > 0) {
        // Skip if we already processed this conversation ID
        if (processedIds.has(item.conversationId)) return;
        
        // Skip if we already have a conversation with this phone number
        if (item.from && processedFromValues.has(item.from)) return;
        
        deduplicatedQueue.push(item);
        processedIds.add(item.conversationId);
        if (item.from) processedFromValues.add(item.from);
      }
    });
    
    // Finally, process any remaining conversations that might be important
    currentQueue.forEach(item => {
      if (!processedIds.has(item.conversationId)) {
        // Skip empty conversations without a phone number
        if ((!item.messages || item.messages.length === 0) && !item.from) return;
        
        // Skip if we already have a conversation with this phone number
        if (item.from && processedFromValues.has(item.from)) return;
        
        deduplicatedQueue.push(item);
        processedIds.add(item.conversationId);
        if (item.from) processedFromValues.add(item.from);
      }
    });
    
    // Update the queue if there's a change
    if (deduplicatedQueue.length < currentQueue.length) {
      console.log(`Deduplication reduced queue from ${currentQueue.length} to ${deduplicatedQueue.length} conversations`);
      this.queueSubject.next(deduplicatedQueue);
    }
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
        
        // Skip duplicates using message ID
        if (message.id && this.recentMessageIds.has(message.id)) {
          console.log('Received duplicate message, skipping:', message.id);
          return;
        }
        
        // Add to recent messages
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
        
        // Get current queue
        const currentQueue = this.queueSubject.value;
        
        // Check if this is a "ghost" conversation created by message sending
        // These typically have no messages or very few properties set
        const isGhostConversation = !newConversation.messages || 
                                 newConversation.messages.length === 0 ||
                                 (newConversation.from && 
                                  currentQueue.some(item => item.from === newConversation.from));
        
        if (isGhostConversation) {
          console.log('Ignoring likely ghost conversation:', newConversation.conversationId);
          return;
        }
        
        // Validate the conversation
        const validatedConversation = this.validateQueueItem(newConversation);
        
        // Check if we already have this conversation using our comprehensive comparison
        const existing = currentQueue.find(item => {
          // First check direct ID matches
          if ((item.id && validatedConversation.id && item.id === validatedConversation.id) ||
              (item.conversationId && validatedConversation.conversationId && 
               item.conversationId === validatedConversation.conversationId)) {
            return true;
          }
          
          // Then check for same phone/from field
          if (item.from && validatedConversation.from && 
              item.from === validatedConversation.from) {
            return true;
          }
          
          return false;
        });
        
        if (existing) {
          console.log('Conversation already in queue, updating instead of adding new:', validatedConversation.conversationId);
          // Important: preserve the assignment when updating
          this.updateQueueItem(validatedConversation, true);
          return;
        }
        
        // Add to queue only if it's truly new
        console.log('Adding brand new conversation to queue:', validatedConversation.conversationId);
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
  private updateQueueItem(updatedItem: QueueItem, preserveAssignment: boolean = false): void {
    const validatedItem = this.validateQueueItem(updatedItem);
    const currentQueue = this.queueSubject.value;
    
    // Find index using our comprehensive comparison function
    const index = currentQueue.findIndex(item => this.areConversationsSame(item, validatedItem));
    
    if (index !== -1) {
      // Update existing conversation
      const updatedQueue = [...currentQueue];
      
      // Preserve the original IDs
      const originalIds = {
        id: updatedQueue[index].id,
        conversationId: updatedQueue[index].conversationId
      };
      
      // Preserve assignment if requested and it exists
      const originalAssignment = preserveAssignment ? updatedQueue[index].assignedAgent : null;
      
      // Create updated item with preserved IDs
      updatedQueue[index] = {
        ...validatedItem,
        id: originalIds.id || validatedItem.id,
        conversationId: originalIds.conversationId || validatedItem.conversationId,
        // If preserving assignment and there was one, keep it (otherwise use the new value)
        assignedAgent: preserveAssignment && originalAssignment ? originalAssignment : validatedItem.assignedAgent
      };
      
      this.queueSubject.next(updatedQueue);
      console.log('Updated existing conversation in queue:', updatedQueue[index].conversationId, 
                   'Assignment:', updatedQueue[index].assignedAgent);
    } else {
      console.log('Adding new conversation to queue:', { 
        id: validatedItem.id,
        conversationId: validatedItem.conversationId,
        from: validatedItem.from,
        assignedAgent: validatedItem.assignedAgent
      });
      
      // Add to queue
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
      
      // Preserve assignment when updating messages
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