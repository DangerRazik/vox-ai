import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoRole } from '../batches/batch-models';
import { DemoAccess } from './demo-access';

@Component({
  selector: 'app-demo-shell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="skip-link"
      [routerLink]="[]"
      queryParamsHandling="preserve"
      fragment="main-content"
      (click)="mainContent.focus()"
      >Перейти к содержимому</a
    >
    <header class="topbar">
      <div class="product-brand">
        <a class="brand" routerLink="/" aria-label="Vox AI — демо-вход">vox<span> ai</span></a>
        <span class="product-description">Контроль качества звонков</span>
      </div>
      <span class="demo-label">Демо · условные данные</span>
      <div class="header-context">
        <ng-content select="[organization-selector]"
          ><span class="organization-name">{{ organizationName() }}</span></ng-content
        >
        <a routerLink="/" class="exit-link" (click)="access.leave()">Выйти из демо</a>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <nav aria-label="Основное меню">
          <a
            [routerLink]="['/demo', role(), 'batches']"
            [queryParams]="listQueryParams()"
            [attr.aria-current]="activeSection() === 'batches' ? 'location' : null"
            ><span aria-hidden="true">▤</span> Батчи</a
          >
          @if (role() === 'team') {
            <a
              routerLink="/demo/team/customers"
              [attr.aria-current]="activeSection() === 'customers' ? 'location' : null"
            >
              <span aria-hidden="true">♧</span> Заказчики
            </a>
            <a
              routerLink="/demo/team/streams"
              [queryParams]="listQueryParams()"
              [attr.aria-current]="activeSection() === 'streams' ? 'location' : null"
            >
              <span aria-hidden="true">≋</span> Стримы
            </a>
          } @else {
            <a
              routerLink="/demo/customer/streams"
              [queryParams]="listQueryParams()"
              [attr.aria-current]="activeSection() === 'streams' ? 'location' : null"
            >
              <span aria-hidden="true">≋</span> Стримы
            </a>
            <a
              routerLink="/demo/customer/comparison"
              [queryParams]="listQueryParams()"
              [attr.aria-current]="activeSection() === 'comparison' ? 'location' : null"
            >
              <span aria-hidden="true">⇄</span> Сравнение
            </a>
          }
        </nav>
      </aside>
      <main #mainContent id="main-content" class="main-content" tabindex="-1"><ng-content /></main>
    </div>
  `,
})
export class DemoShell {
  protected readonly access = inject(DemoAccess);
  readonly role = input.required<DemoRole>();
  readonly organizationName = input.required<string>();
  readonly activeSection = input<'batches' | 'streams' | 'comparison' | 'customers'>('batches');
  readonly listQueryParams = input<{ organization: string; stream: string } | null>(null);
}
