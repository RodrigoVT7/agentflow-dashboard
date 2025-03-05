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
      this.messages = [...this.conversation.messages];
      this.scrollToBottom();
    }
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
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
      this.messages = [...this.conversation.messages];
    }
    
    // Then load any additional messages from the API
    this.conversationService.getMessages(this.conversation.conversationId)
      .subscribe(messages => {
        this.messages = messages;
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
    
    // Send message via WebSocket for immediate response
    this.conversationService.sendMessageWs(
      this.conversation.conversationId, 
      messageText
    );
    
    // Also send via HTTP endpoint
    this.conversationService.sendMessage(
      this.conversation.conversationId, 
      messageText
    ).subscribe({
      next: () => {
        this.messageForm.reset();
        this.sending = false;
      },
      error: (error) => {
        console.error('Error sending message:', error);
        this.sending = false;
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
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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