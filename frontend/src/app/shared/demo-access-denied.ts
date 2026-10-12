import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoShell } from './demo-shell';

@Component({
  selector: 'app-demo-access-denied',
  imports: [DemoShell, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-demo-shell role="customer" organizationName="Демонстрационный режим">
    <div class="state-panel error-panel" role="alert">
      <h1>Доступ только для команды Vox AI</h1>
      <p>
        В режиме заказчика создание организаций недоступно. Выбрать демонстрационный раздел можно на
        странице входа.
      </p>
      <a class="button secondary" routerLink="/">К демо-входу</a>
    </div>
  </app-demo-shell>`,
})
export class DemoAccessDenied {}
