import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { QueueItem } from '../../models/conversation.model';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-queue-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './queue-panel.component.html',
  styleUrls: ['./queue-panel.component.css']
})
export class QueuePanelComponent implements OnInit {
  @Input() queue: QueueItem[] = [];
  @Input() activeConversationId: string | null = null;
  @Output() selectConversation = new EventEmitter<QueueItem>();
  @Output() assignAgent = new EventEmitter<string>();
  
  // Filter options
  showAll = true;
  showUnassigned = false;
  showMine = false;
  
  constructor(private authService: AuthService) { }

  ngOnInit(): void {
  }

  // Get filtered queue based on current filter settings
  get filteredQueue(): QueueItem[] {
    if (this.showAll) {
      return this.queue;
    }
    
    const currentAgentId = this.authService.getCurrentAgent()?.id;
    
    if (this.showMine && currentAgentId) {
      return this.queue.filter(item => item.assignedAgent === currentAgentId);
    }
    
    if (this.showUnassigned) {
      return this.queue.filter(item => !item.assignedAgent);
    }
    
    return this.queue;
  }

  onSelectConversation(conversation: QueueItem): void {
    this.selectConversation.emit(conversation);
  }

  onAssignAgent(conversationId: string): void {
    this.assignAgent.emit(conversationId);
  }

  formatWaitTime(startTime: number): string {
    const waitTimeMs = Date.now() - startTime;
    const minutes = Math.floor(waitTimeMs / 60000);
    
    if (minutes < 1) {
      return 'Just now';
    } else if (minutes === 1) {
      return '1 minute';
    } else if (minutes < 60) {
      return `${minutes} minutes`;
    } else {
      const hours = Math.floor(minutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
  }

  isConversationAssignedToMe(conversation: QueueItem): boolean {
    const currentAgentId = this.authService.getCurrentAgent()?.id;
    return conversation.assignedAgent === currentAgentId;
  }

  setFilter(filter: 'all' | 'unassigned' | 'mine'): void {
    this.showAll = filter === 'all';
    this.showUnassigned = filter === 'unassigned';
    this.showMine = filter === 'mine';
  }
}