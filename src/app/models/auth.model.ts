import { Agent } from './agent.model';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  agent: Agent;
  expiresIn: number;
}

export interface DecodedToken {
  agentId: string;
  email: string;
  role: string;
  exp: number;
  iat: number;
}