// src/app/conversations/chat/chat.component.ts
import { Component, Input, OnChanges, OnInit, SimpleChanges, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { QueueItem } from '../../models/conversation.model';
import { Message, MessageSender } from '../../models/message.model';
import { ConversationService } from '../../services/conversation.service';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnChanges, AfterViewChecked {
  @Input() conversation!: QueueItem;
  @ViewChild('chatMessages') chatMessages!: ElementRef;
  
  messages: Message[] = [];
  messageForm: FormGroup;
  sending = false;
  MessageSender = MessageSender; // For template access
  
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

  private loadMessages(): void {
    // First, set any messages we already have from the queue
    if (this.conversation.messages) {
      // Filter out invalid messages
      this.messages = this.conversation.messages.filter(m => !!m && !!m.text && !!m.from);
    }
    
    // Then load any additional messages from the API
    this.conversationService.getMessages(this.conversation.conversationId)
      .subscribe(messages => {
        // Filter out invalid messages
        this.messages = messages.filter(m => !!m && !!m.text && !!m.from);
        setTimeout(() => this.scrollToBottom(), 100);
      });
  }

  sendMessage(): void {
    if (this.messageForm.invalid || this.sending) {
      return;
    }
    
    const messageText = this.messageForm.value.message.trim();
    if (!messageText) {
      return;
    }
    
    this.sending = true;
    
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
    
    // CRITICAL CHANGE: Use HTTP instead of WebSocket for sending messages
    // This helps prevent the duplication issue as HTTP is more "atomic"
    this.conversationService.sendMessage(
      this.conversation.conversationId, 
      messageText
    ).subscribe({
      next: (response) => {
        console.log('Message sent successfully via HTTP');
        this.sending = false;
        
        // Ensure the conversation is now updated in our local state
        this.conversationService.refreshConversation(this.conversation.conversationId);
      },
      error: (error) => {
        console.error('Error sending message:', error);
        this.sending = false;
        
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
    if (confirm('Are you sure you want to complete this conversation?')) {
      // Complete via WebSocket for immediate response
      this.conversationService.completeConversationWs(this.conversation.conversationId);
      
      // Also complete via HTTP endpoint
      this.conversationService.completeConversation(this.conversation.conversationId)
        .subscribe(() => {
          // Conversation will be removed from active in service
        });
    }
  }

  updatePriority(priority: number): void {
    this.conversationService.updatePriority(this.conversation.conversationId, priority)
      .subscribe();
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
      'system-message': message.from === MessageSender.SYSTEM
    };
  }

  isCurrentAgent(message: Message): boolean {
    return message.from === MessageSender.AGENT && 
           message.agentId === this.authService.getCurrentAgent()?.id;
  }
}