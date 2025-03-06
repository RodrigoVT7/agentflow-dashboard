import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { filter, map } from 'rxjs/operators';

interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<WebSocketMessage>();
  private reconnectInterval = 5000; // 5 seconds
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private lastPongTime = 0;
  private pingInterval: any;
  private messageQueue: {type: string, payload: any}[] = [];
  private isConnected = new BehaviorSubject<boolean>(false);
  public isConnected$ = this.isConnected.asObservable();

  constructor(private authService: AuthService) {
    // Auto-reconnect when authentication state changes
    this.authService.currentAgent$.subscribe(agent => {
      if (agent) {
        this.connect();
      } else {
        this.disconnect();
      }
    });
  }

  public connect(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    const token = this.authService.getToken();
    if (!token) {
      console.error('No authentication token available');
      return Promise.reject('No authentication token available');
    }

    return new Promise((resolve, reject) => {
      const wsUrl = `${environment.wsUrl}?token=${token}`;
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.isConnected.next(true);
        this.startPingPong();
        
        // Process any queued messages
        this.processQueue();
        resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          this.messageSubject.next(message);
          
          // Handle ping/pong for connection health
          if (message.type === 'pong') {
            this.lastPongTime = Date.now();
          }
        } catch (error) {
          console.error('Error parsing WebSocket message', error);
        }
      };

      this.socket.onclose = (event) => {
        console.log('WebSocket connection closed', event);
        this.isConnected.next(false);
        this.stopPingPong();
        
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.authService.isLoggedIn()) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), this.reconnectInterval);
        }
        
        if (!event.wasClean) {
          reject('WebSocket connection closed unexpectedly');
        }
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket error', error);
        this.isConnected.next(false);
        reject(error);
      };
    });
  }

  // Start ping-pong to keep connection alive
  private startPingPong(): void {
    this.stopPingPong(); // Clear existing ping interval
    
    this.pingInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send('ping', {});
        
        // Check if we haven't received a pong in a while
        if (this.lastPongTime && (Date.now() - this.lastPongTime) > 15000) {
          console.warn('No pong received in 15 seconds, reconnecting...');
          this.reconnect();
        }
      }
    }, 10000); // Ping every 10 seconds
  }
  
  private stopPingPong(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public disconnect(): void {
    this.stopPingPong();
    this.isConnected.next(false);
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private reconnect(): void {
    this.disconnect();
    this.connect();
  }

  public send(type: string, payload: any): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not connected, queueing message:', type);
      this.messageQueue.push({ type, payload });
      this.connect().catch(err => console.error('Error connecting WebSocket:', err));
      return;
    }

    const message = {
      type,
      payload,
      timestamp: Date.now()
    };

    this.socket.send(JSON.stringify(message));
  }
  
  private processQueue(): void {
    if (this.messageQueue.length === 0) return;
    
    console.log(`Processing ${this.messageQueue.length} queued WebSocket messages`);
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message.type, message.payload);
      }
    }
  }

  public onMessage<T>(type?: string): Observable<T> {
    if (type) {
      return this.messageSubject.asObservable().pipe(
        filter(message => message.type === type),
        map(message => message.payload as T)
      );
    }
    
    return this.messageSubject.asObservable().pipe(
      map(message => message.payload as T)
    );
  }

  public onAnyMessage(): Observable<WebSocketMessage> {
    return this.messageSubject.asObservable();
  }
}