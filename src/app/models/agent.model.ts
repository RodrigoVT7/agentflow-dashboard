export enum AgentStatus {
    OFFLINE = 'offline',
    ONLINE = 'online',
    BUSY = 'busy',
    AWAY = 'away',
  }
  
  export interface Agent {
    id: string;
    name: string;
    email: string;
    status: AgentStatus;
    activeConversations: string[];
    maxConcurrentChats: number;
    role: 'agent' | 'supervisor' | 'admin';
    lastActivity: number;
  }
  
  export interface AgentRegistration {
    name: string;
    email: string;
    password: string;
    role?: 'agent' | 'supervisor' | 'admin';
    maxConcurrentChats?: number;
  }