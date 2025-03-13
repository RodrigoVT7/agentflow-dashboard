// src/app/conversations/chat/chat.component.ts
import { Component, Input, OnChanges, OnInit, SimpleChanges, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { QueueItem } from '../../models/conversation.model';
import { Message, MessageSender } from '../../models/message.model';
import { ConversationService } from '../../services/conversation.service';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnChanges, AfterViewChecked {
  @Input() conversation!: QueueItem;
  @Input() readOnly: boolean = false; // Nuevo: Para modo solo lectura
  @ViewChild('chatMessages') chatMessages!: ElementRef;
  
  messages: Message[] = [];
  messageForm: FormGroup;
  sending = false;
  MessageSender = MessageSender; // For template access
  errorMessage = '';
  
  constructor(
    private formBuilder: FormBuilder,
    private conversationService: ConversationService,
    private authService: AuthService
  ) {
    this.messageForm = this.formBuilder.group({
      message: ['', [Validators.required, Validators.maxLength(4000)]]
    });
  }

  ngOnInit(): void {
    if (this.conversation) {
      this.loadMessages();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['conversation'] && this.conversation) {
      // Filter out invalid messages before assigning
      this.messages = this.conversation.messages
        ? this.conversation.messages.filter(m => !!m && !!m.text && !!m.from)
        : [];
      this.scrollToBottom();
    }
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  /**
   * Checks if an agent is assigned to the current conversation
   */
  isAgentAssigned(): boolean {
    return !!this.conversation?.assignedAgent;
  }

  private scrollToBottom(): void {
    try {
      if (this.chatMessages) {
        this.chatMessages.nativeElement.scrollTop = this.chatMessages.nativeElement.scrollHeight;
      }
    } catch (err) {
      console.error(err);
    }
  }

// En chat.component.ts
private loadMessages(): void {
  if (this.conversation) {
    // Mostrar los mensajes que ya tenemos 
    const existingMessages = this.conversation.messages?.filter(m => !!m && !!m.text) || [];
    this.messages = existingMessages;
    
    console.log(`Cargando mensajes para conversación ${this.conversation.conversationId}, tiene ${existingMessages.length} mensajes iniciales`);
    
    // En conversaciones completadas, a veces los mensajes ya vienen incluidos
    // y no es necesario cargarlos nuevamente
    const isCompletedConversation = this.conversation.metadata?.isCompleted;
    
    if (existingMessages.length > 0 && isCompletedConversation) {
      console.log('Usando mensajes incluidos en la conversación completada');
      setTimeout(() => this.scrollToBottom(), 100);
      return; // Ya tenemos los mensajes, no necesitamos cargar más
    }
    
    // Cargar todos los mensajes de la API
    this.conversationService.getMessages(this.conversation.conversationId)
      .subscribe({
        next: (messages) => {
          console.log(`Recibidos ${messages.length} mensajes para ${this.conversation.conversationId}`);
          
          // Mostrar un mensaje de diagnóstico si parece que faltan mensajes
          if (messages.length === 0 && this.messages.length === 0) {
            console.warn(`⚠️ No se encontraron mensajes para la conversación ${this.conversation.conversationId}`);
          }
          
          if (messages.length > 0) {
            // Combinar mensajes y eliminar duplicados
            const uniqueMessages = new Map<string, Message>();
            
            // Añadir mensajes existentes
            this.messages.forEach(msg => {
              if (msg.id) {
                uniqueMessages.set(msg.id, msg);
              }
            });
            
            // Añadir nuevos mensajes
            messages.filter(m => !!m && !!m.text).forEach(msg => {
              if (msg.id) {
                uniqueMessages.set(msg.id, msg);
              }
            });
            
            // Convertir a array y ordenar por timestamp
            this.messages = Array.from(uniqueMessages.values())
              .sort((a, b) => a.timestamp - b.timestamp);
            
            setTimeout(() => this.scrollToBottom(), 100);
          }
        },
        error: (error) => {
          console.error('Error cargando mensajes:', error);
          this.errorMessage = 'No se pudieron cargar todos los mensajes.';
        }
      });
  }
}

  sendMessage(): void {
    // No enviar mensajes en modo solo lectura
    if (this.readOnly) {
      return;
    }
    
    if (this.messageForm.invalid || this.sending) {
      return;
    }
    
    const messageText = this.messageForm.value.message.trim();
    if (!messageText) {
      return;
    }
    
    this.sending = true;
    this.errorMessage = '';
    
    // Create an optimistic message to display immediately
    const tempId = 'temp-' + Date.now();
    const optimisticMessage: Message = {
      id: tempId,
      conversationId: this.conversation.conversationId,
      from: MessageSender.AGENT,
      text: messageText,
      timestamp: Date.now(),
      agentId: this.authService.getCurrentAgent()?.id
    };
    
    // Add to local messages immediately (optimistic update)
    this.messages = [...this.messages, optimisticMessage];
    this.scrollToBottom();
    
    // Reset the form before sending to prevent duplicate messages
    this.messageForm.reset();
    
    // Send the message via HTTP
    this.conversationService.sendMessage(
      this.conversation.conversationId, 
      messageText
    ).pipe(
      finalize(() => {
        this.sending = false;
      })
    ).subscribe({
      next: (response) => {
        console.log('Message sent successfully');
        
        // Update the optimistic message with the real message ID
        const index = this.messages.findIndex(m => m.id === tempId);
        if (index !== -1) {
          const updatedMessages = [...this.messages];
          updatedMessages[index] = {
            ...updatedMessages[index],
            id: response.messageId
          };
          this.messages = updatedMessages;
        }
        
        // Refresh the conversation to get the latest state
        this.conversationService.refreshConversation(this.conversation.conversationId);
      },
      error: (error) => {
        console.error('Error sending message:', error);
        this.errorMessage = 'Failed to send message. Please try again.';
        
        // Mark the optimistic message as failed
        const index = this.messages.findIndex(m => m.id === tempId);
        if (index !== -1) {
          const updatedMessages = [...this.messages];
          updatedMessages[index] = {
            ...updatedMessages[index],
            metadata: { error: 'Failed to send' }
          };
          this.messages = updatedMessages;
        }
      }
    });
  }

  completeConversation(): void {
    // No completar conversaciones en modo solo lectura
    if (this.readOnly) {
      return;
    }
    
    if (confirm('Are you sure you want to complete this conversation?')) {
      this.conversationService.completeConversation(this.conversation.conversationId)
        .subscribe({
          next: () => {
            console.log('Conversation completed successfully');
          },
          error: (error) => {
            console.error('Error completing conversation:', error);
            this.errorMessage = 'Failed to complete conversation. Please try again.';
          }
        });
    }
  }

  updatePriority(priority: number): void {
    // No actualizar prioridad en modo solo lectura
    if (this.readOnly) {
      return;
    }
    
    this.conversationService.updatePriority(this.conversation.conversationId, priority)
      .subscribe({
        next: () => {
          console.log(`Priority updated to ${priority}`);
        },
        error: (error) => {
          console.error('Error updating priority:', error);
          this.errorMessage = 'Failed to update priority. Please try again.';
        }
      });
  }

  formatTimestamp(timestamp: number): string {
    return timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  }

  getMessageClasses(message: Message): any {
    return {
      'chat-message': true,
      'user-message': message.from === MessageSender.USER,
      'bot-message': message.from === MessageSender.BOT,
      'agent-message': message.from === MessageSender.AGENT,
      'system-message': message.from === MessageSender.SYSTEM,
      'failed-message': message.metadata && message.metadata['error'] ? true : false
    };
  }

  isCurrentAgent(message: Message): boolean {
    return message.from === MessageSender.AGENT && 
           message.agentId === this.authService.getCurrentAgent()?.id;
  }

  // Check if a message has an error
  hasError(message: Message): boolean {
    return !!(message.metadata && message.metadata['error']);
  }

  // Get error message
  getErrorMessage(message: Message): string {
    return message.metadata && message.metadata['error'] 
      ? message.metadata['error'] 
      : 'Error sending message';
  }

  // Retry sending a failed message
  retryMessage(message: Message): void {
    // No reenviar mensajes en modo solo lectura
    if (this.readOnly) {
      return;
    }
    
    // Remove the failed message
    this.messages = this.messages.filter(m => m.id !== message.id);
    
    // Add the text to the input field
    this.messageForm.setValue({ message: message.text });
    
    // Focus the input
    setTimeout(() => {
      document.getElementById('messageInput')?.focus();
    }, 0);
  }
}