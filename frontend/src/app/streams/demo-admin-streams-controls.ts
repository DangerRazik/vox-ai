import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DemoAdminStreamsSource } from './demo-admin-streams-source';

@Component({
  selector: 'app-demo-admin-streams-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="demo-controls">
      <summary>Демо-сценарии административных стримов</summary>
      <p>Сбой действует на одну попытку. Ошибка создания происходит до добавления стрима.</p>
      @if (operation() === 'create') {
        <button
          class="button secondary"
          [disabled]="locked()"
          (click)="source.simulateNextCreateError()"
        >
          Сбой следующего создания
        </button>
      } @else {
        <button class="button secondary" [disabled]="locked()" (click)="readError()">
          Показать ошибку чтения
        </button>
      }
      @if (canDelete()) {
        <button
          class="button secondary"
          [disabled]="locked()"
          (click)="source.simulateNextDeleteError()"
        >
          Сбой следующего удаления
        </button>
      }
    </details>
  `,
})
export class DemoAdminStreamsControls {
  readonly locked = input(false);
  readonly canDelete = input(false);
  readonly operation = input<'read' | 'create'>('read');
  readonly reloadRequested = output<void>();
  protected readonly source = inject(DemoAdminStreamsSource);
  protected readError(): void {
    this.source.simulateNextReadError();
    this.reloadRequested.emit();
  }
}
