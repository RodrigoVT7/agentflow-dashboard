import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QueueItem } from '../../models/conversation.model';
import { ConversationService } from '../../services/conversation.service';
import { ChatComponent } from '../chat/chat.component';

@Component({
  selector: 'app-conversation-history',
  standalone: true,
  imports: [CommonModule, ChatComponent],
  templateUrl: './conversation-history.component.html',
  styleUrls: ['./conversation-history.component.css']
})
export class ConversationHistoryComponent implements OnInit {
  completedConversations: QueueItem[] = [];
  selectedConversation: QueueItem | null = null;
  loading = true;
  error = '';

  constructor(private conversationService: ConversationService) { }

  ngOnInit(): void {
    this.loadCompletedConversations();
  }

  loadCompletedConversations(): void {
    this.loading = true;
    this.error = '';
    
    this.conversationService.getCompletedConversations().subscribe({
      next: (conversations) => {
        this.completedConversations = conversations;
        this.loading = false;
      },
      error: (error) => {
        this.error = 'Error al cargar el historial.';
        this.loading = false;
        console.error('Error loading history:', error);
      }
    });
  }

  selectConversation(conversation: QueueItem): void {
    this.selectedConversation = conversation;
  }
  
  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
  
  // Nuevo método para formatear la fecha completada
  formatCompletedDate(item: QueueItem): string {
    // Intentamos obtener la fecha de completado desde metadata
    if (item.metadata && typeof item.metadata === 'object' && 'completedAt' in item.metadata) {
      const completedAt = item.metadata['completedAt'];
      if (typeof completedAt === 'number') {
        return new Date(completedAt).toLocaleString();
      }
    }
    
    // Si no hay fecha, usamos la fecha de inicio como fallback
    return new Date(item.startTime).toLocaleString();
  }
}