import { Injectable } from '@angular/core';
import { QueueItem } from '../models/conversation.model';

@Injectable({
  providedIn: 'root'
})
export class QueueManagerService {
  private readonly PROCESSED_CONVERSATIONS_KEY = 'processed_conversations';
  // Track how long we want to remember processed conversations (10 minutes)
  private readonly REMEMBER_DURATION = 10 * 60 * 1000;
  
  constructor() {
    // Periodically clean up old processed conversations
    setInterval(() => this.cleanupProcessedConversations(), 60000);
  }
  
  /**
   * Check if this conversation ID should be added to the queue
   * Returns true if it's a new conversation or one we haven't processed recently
   */
  shouldAddToQueue(item: QueueItem): boolean {
    if (!item || !item.conversationId) return false;
    
    // Check if this is a zero-message conversation or empty conversation ID
    if (!item.messages || item.messages.length === 0 || !item.conversationId.trim()) {
      return false;
    }
    
    // Check if we've processed this EXACT conversation ID recently
    // (not just the phone number)
    const processedConversations = this.getProcessedConversations();
    const processInfo = processedConversations[item.conversationId];
    
    if (processInfo) {
      // Si esta conversación específica (por ID) tiene el mismo número de mensajes 
      // o más en nuestro registro, es probablemente un duplicado
      if (processInfo.messageCount >= item.messages.length) {
        console.log('Ignoring duplicate conversation ID:', item.conversationId);
        return false;
      }
    }
    
    // Mark this conversation as processed with its current message count
    this.markAsProcessed(item.conversationId, item.messages.length);
    return true;
  }
  
  /**
   * Verifica si este es un número de teléfono del que ya hemos visto conversaciones,
   * pero permite nuevas conversaciones con nuevos IDs
   */
  isNewPhoneNumberConversation(phoneNumber: string, conversationId: string): boolean {
    // Si no hay número de teléfono o ID de conversación, no es una conversación válida
    if (!phoneNumber || !conversationId) return false;
    
    try {
      // Obtener el registro de números de teléfono procesados
      const phoneNumberKey = 'processed_phone_numbers';
      const storedNumbers = localStorage.getItem(phoneNumberKey) || '{}';
      const processedNumbers = JSON.parse(storedNumbers) as Record<string, string[]>;
      
      // Si este número no está registrado, es definitivamente nuevo
      if (!processedNumbers[phoneNumber]) {
        // Registrar este número y su primera conversación
        processedNumbers[phoneNumber] = [conversationId];
        localStorage.setItem(phoneNumberKey, JSON.stringify(processedNumbers));
        return true;
      }
      
      // Si la conversación ya está registrada para este número, no es nueva
      if (processedNumbers[phoneNumber].includes(conversationId)) {
        return false;
      }
      
      // Es un ID de conversación nuevo para un número existente
      // Añadir a la lista y guardar
      processedNumbers[phoneNumber].push(conversationId);
      
      // Limitar el tamaño de la lista para evitar que crezca demasiado
      if (processedNumbers[phoneNumber].length > 20) {
        processedNumbers[phoneNumber] = processedNumbers[phoneNumber].slice(-20);
      }
      
      localStorage.setItem(phoneNumberKey, JSON.stringify(processedNumbers));
      return true;
      
    } catch (error) {
      console.error('Error checking new phone number conversation:', error);
      return true; // En caso de error, asumimos que es nueva para no perder conversaciones
    }
  }
  
  /**
   * Store this conversation ID as processed with the message count
   */
  markAsProcessed(conversationId: string, messageCount: number): void {
    try {
      const processed = this.getProcessedConversations();
      processed[conversationId] = {
        timestamp: Date.now(),
        messageCount
      };
      localStorage.setItem(this.PROCESSED_CONVERSATIONS_KEY, JSON.stringify(processed));
    } catch (error) {
      console.error('Error marking conversation as processed', error);
    }
  }
  
  /**
   * Get the map of processed conversation IDs with their timestamps
   */
  private getProcessedConversations(): Record<string, {timestamp: number, messageCount: number}> {
    try {
      const stored = localStorage.getItem(this.PROCESSED_CONVERSATIONS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Error reading processed conversations', error);
      return {};
    }
  }
  
  /**
   * Remove old processed conversations to keep the storage size manageable
   */
  private cleanupProcessedConversations(): void {
    try {
      const processed = this.getProcessedConversations();
      const now = Date.now();
      let changed = false;
      
      // Remove entries older than REMEMBER_DURATION
      Object.keys(processed).forEach(id => {
        if (now - processed[id].timestamp > this.REMEMBER_DURATION) {
          delete processed[id];
          changed = true;
        }
      });
      
      // Only write back if we made changes
      if (changed) {
        localStorage.setItem(this.PROCESSED_CONVERSATIONS_KEY, JSON.stringify(processed));
      }
    } catch (error) {
      console.error('Error cleaning up processed conversations', error);
    }
  }
}