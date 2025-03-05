import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentFormComponent } from './agent-form.component';

describe('AgentFormComponent', () => {
  let component: AgentFormComponent;
  let fixture: ComponentFixture<AgentFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentFormComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AgentFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
