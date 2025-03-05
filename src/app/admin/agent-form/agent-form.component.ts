import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Agent, AgentRegistration } from '../../models/agent.model';
import { AgentService } from '../../services/agent.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-agent-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './agent-form.component.html',
  styleUrls: ['./agent-form.component.css']
})
export class AgentFormComponent implements OnInit {
  @Output() agentCreated = new EventEmitter<Agent>();
  @Output() cancel = new EventEmitter<void>();
  
  agentForm: FormGroup;
  submitting = false;
  errorMessage = '';
  
  roles = [
    { value: 'agent', label: 'Agent' },
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'admin', label: 'Administrator' }
  ];

  constructor(
    private formBuilder: FormBuilder,
    private agentService: AgentService
  ) {
    this.agentForm = this.formBuilder.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      role: ['agent', [Validators.required]],
      maxConcurrentChats: [3, [Validators.required, Validators.min(1), Validators.max(10)]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  ngOnInit(): void {
  }

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;
    
    if (password !== confirmPassword) {
      form.get('confirmPassword')?.setErrors({ mismatch: true });
      return { mismatch: true };
    }
    
    return null;
  }

  onSubmit(): void {
    if (this.agentForm.invalid || this.submitting) {
      return;
    }
    
    this.submitting = true;
    this.errorMessage = '';
    
    const formValue = this.agentForm.value;
    
    // Create registration object (omitting confirmPassword)
    const registration: AgentRegistration = {
      name: formValue.name,
      email: formValue.email,
      password: formValue.password,
      role: formValue.role,
      maxConcurrentChats: formValue.maxConcurrentChats
    };
    
    this.agentService.registerAgent(registration).subscribe({
      next: (agent) => {
        this.agentCreated.emit(agent);
        this.submitting = false;
        this.agentForm.reset({
          role: 'agent',
          maxConcurrentChats: 3
        });
      },
      error: (error) => {
        this.errorMessage = error.error?.error || 'Failed to register agent. Please try again.';
        this.submitting = false;
        console.error('Error registering agent:', error);
      }
    });
  }

  onCancel(): void {
    this.cancel.emit();
  }
  
  // Convenience getter for easy access to form fields
  get f() { 
    return this.agentForm.controls; 
  }
}