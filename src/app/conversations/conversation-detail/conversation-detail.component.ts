import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessageListComponent } from '../message-list/message-list.component';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [CommonModule, MessageListComponent],
  templateUrl: './conversation-detail.component.html',
  styleUrls: ['./conversation-detail.component.css']
})
export class ConversationDetailComponent {

}
