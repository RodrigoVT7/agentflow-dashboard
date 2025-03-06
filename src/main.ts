import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Extend the appConfig with animations provider
const providers = [...appConfig.providers, provideAnimations()];

bootstrapApplication(AppComponent, {
  providers
}).catch(err => console.error(err));