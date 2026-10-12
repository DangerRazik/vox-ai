import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DemoAccess } from './shared/demo-access';

@Component({
  selector: 'app-demo-entry',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="entry">
      <div class="entry-brand">vox<span> ai</span></div>
      <div class="demo-label">Демо · условные данные</div>
      <h1>Качество звонков.<br />Понятные результаты.</h1>
      <p class="entry-description">
        Рабочее пространство для анализа разговоров и оценки работы сотрудников колл-центра.
      </p>
      <p class="entry-note">
        <a class="button primary" routerLink="/connect">Подключиться по ключу</a>
      </p>
      <div class="entry-options">
        <section class="entry-option">
          <div class="option-icon" aria-hidden="true">01</div>
          <h2>Заказчик</h2>
          <p>Батчи вашей организации и единые правила анализа.</p>
          <button class="button primary" (click)="open('customer')">
            Открыть демо заказчика <span aria-hidden="true">→</span>
          </button>
        </section>
        <section class="entry-option">
          <div class="option-icon" aria-hidden="true">02</div>
          <h2>Команда Vox AI</h2>
          <p>Рабочее пространство для сопровождения заказчиков.</p>
          <button class="button secondary" (click)="open('team')">
            Открыть демо команды <span aria-hidden="true">→</span>
          </button>
        </section>
      </div>
      <p class="entry-note">Показаны условные загрузки. Записи не отправляются на анализ.</p>
    </main>
  `,
})
export class DemoEntry {
  private readonly access = inject(DemoAccess);
  constructor(private readonly router: Router) {}
  protected open(role: 'customer' | 'team'): void {
    this.access.open(role);
    void this.router.navigate(['/demo', role, 'batches']);
  }
}
