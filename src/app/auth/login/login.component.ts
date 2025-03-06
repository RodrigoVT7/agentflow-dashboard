import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})

export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  loading = false;
  errorMessage = '';
  returnUrl = '/dashboard';

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {
    // Redirect if already logged in
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    }
    
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    // Get return URL from route parameters or default to '/dashboard'
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
  }

  // Convenience getter for easy access to form fields
  get f() { 
    return this.loginForm.controls; 
  }

  onSubmit(): void {
    // Stop if form is invalid
    if (this.loginForm.invalid) {
      return;
    }
  
    this.loading = true;
    this.errorMessage = '';
  
    this.authService.login(this.loginForm.value)
      .subscribe({
        next: () => {
          console.log('[LoginComponent] Login successful, delaying redirect to ensure token is stored');
          // Add a small delay to ensure token is stored before redirect
          setTimeout(() => {
            this.router.navigate([this.returnUrl]);
          }, 500);
        },
        error: error => {
          this.errorMessage = error.error?.error || 'Login failed. Please check your credentials.';
          this.loading = false;
          console.error('[LoginComponent] Login error:', error);
        }
      });
  }
}