import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DemoBatchesSource } from './demo-batches-source';

@Component({
  selector: 'app-demo-state-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="demo-controls">
      <summary>
        {{ scenario() === 'details' ? 'Демо-сценарии состояния' : 'Демо-сценарии' }}
      </summary>
      <p>
        @if (scenario() === 'batches') {
          Для пустого списка выберите стрим «Новый проект».
        }
        Ошибку чтения можно показать кнопкой ниже, затем повторить запрос.
      </p>
      <button class="button secondary" (click)="showError()" [disabled]="locked()">
        Показать ошибку
        {{ names[scenario()] }}
      </button>
    </details>
  `,
})
export class DemoStateControls {
  private readonly source = inject(DemoBatchesSource);
  readonly reloadRequested = output<void>();
  readonly scenario = input<'batches' | 'report' | 'call' | 'details' | 'comparison'>('batches');
  readonly locked = input(false);
  protected readonly names = {
    batches: 'списка',
    report: 'отчёта',
    call: 'звонка',
    details: 'состояния',
    comparison: 'сравнения',
  };

  protected showError(): void {
    if (this.scenario() === 'comparison') this.source.simulateNextComparisonError();
    else if (this.scenario() === 'details') this.source.simulateNextDetailsError();
    else if (this.scenario() === 'call') this.source.simulateNextCallError();
    else if (this.scenario() === 'report') this.source.simulateNextReportError();
    else this.source.simulateNextListError();
    this.reloadRequested.emit();
  }
}
