import { Message } from "./message.model";

// src/app/models/conversation.model.ts
export interface QueueItem {
  // Campo para el ID en el formato del backend
  id?: string;
  // Campo para el ID de conversación formato interno
  conversationId: string;
  // Número de teléfono o identificador del remitente
  from?: string;
  // ID del número de teléfono
  phone_number_id?: string;
  // Tiempo de inicio
  startTime: number;
  // Prioridad
  priority: number;
  // Etiquetas
  tags: string[];
  // Agente asignado
  assignedAgent: string | null;
  // Mensajes
  messages: Message[];
  // Metadatos adicionales
  metadata?: {
    escalationReason?: string;
    userLocation?: string;
    previousInteractions?: number;
    customFields?: Record<string, any>;
    isNewConversation?: boolean;
    isCompleted?: boolean;
    completedAt?: number;
    completedTimestamp?: number;
    messageCount?: number;
    // Añadir estas nuevas propiedades:
    uniqueSessionId?: string;
    sessionStartDate?: string;
  };
}

// Añadir esta interfaz al archivo src/app/models/conversation.model.ts
export interface QueueSummary {
  id: string;
  waitTime: number;
  messageCount: number;
  assignedAgent: string | null;
  priority: number;
  tags: string[];
}