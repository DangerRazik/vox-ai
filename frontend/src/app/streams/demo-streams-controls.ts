import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DemoPublicStreamsSource } from './demo-public-streams-source';

@Component({
  selector: 'app-demo-streams-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="demo-controls">
      <summary>Демо-сценарии стримов</summary>
      <p>Состояния ниже используют условные данные; настройки стримов не меняются.</p>
      <button class="button secondary" [disabled]="locked()" (click)="showError()">
        Показать ошибку чтения
      </button>
      <button class="button secondary" [disabled]="locked()" (click)="showEmpty()">
        Показать пустой список
      </button>
    </details>
  `,
})
export class DemoStreamsControls {
  private readonly source = inject(DemoPublicStreamsSource);
  readonly locked = input(false);
  readonly reloadRequested = output<void>();

  protected showError(): void {
    this.source.simulateNextError();
    this.reloadRequested.emit();
  }

  protected showEmpty(): void {
    this.source.simulateNextEmptyList();
    this.reloadRequested.emit();
  }
}
