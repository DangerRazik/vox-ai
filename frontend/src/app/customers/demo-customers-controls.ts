import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DemoCustomersSource } from './demo-customers-source';

@Component({
  selector: 'app-demo-customers-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<details class="demo-controls">
    <summary>Демо-сценарии заказчиков</summary>
    <p>Условные сбои не обращаются к backend.</p>
    <button class="button secondary" [disabled]="locked()" (click)="failList()">
      Показать ошибку списка
    </button>
    <button class="button secondary" [disabled]="locked()" (click)="failCreation()">
      Сбой следующего создания
    </button>
    <p>Сбой создания действует на одну следующую попытку, до добавления организации.</p>
  </details>`,
})
export class DemoCustomersControls {
  private readonly source = inject(DemoCustomersSource);
  readonly locked = input(false);
  readonly reloadRequested = output<void>();
  protected failCreation(): void {
    this.source.simulateNextCreateError();
  }
  protected failList(): void {
    this.source.simulateNextListError();
    this.reloadRequested.emit();
  }
}
