import { Message } from './message.model';

export enum ConversationStatus {
  BOT = 'bot',
  WAITING = 'waiting',
  ASSIGNED = 'assigned',
  COMPLETED = 'completed',
}

export interface QueueItem {
  conversationId: string;
  from: string;
  phone_number_id: string;
  startTime: number;
  priority: number;
  tags: string[];
  assignedAgent: string | null;
  messages: Message[];
  metadata: {
    escalationReason?: string;
    userLocation?: string;
    previousInteractions?: number;
    customFields?: Record<string, any>;
  };
}

export interface QueueSummary {
  id: string;
  waitTime: number;
  messageCount: number;
  assignedAgent: string | null;
  priority: number;
  tags: string[];
}