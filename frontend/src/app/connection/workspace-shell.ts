import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiConnection } from './api-connection';

@Component({
  selector: 'app-workspace-shell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .exit-link {
      border: 0;
      background: transparent;
      padding: 8px 0;
      font: inherit;
    }
    .organization-name {
      overflow-wrap: anywhere;
      min-width: 0;
    }
    @media (max-width: 760px) {
      .header-context {
        flex-wrap: wrap;
        gap: 12px;
      }
    }
  `,
  template: `
    <a class="skip-link" [routerLink]="[]" fragment="main-content" (click)="main.focus()"
      >Перейти к содержимому</a
    >
    <header class="topbar">
      <div class="product-brand">
        <a class="brand" routerLink="/" aria-label="Vox AI — главная">vox<span> ai</span></a>
        <span class="product-description">Контроль качества звонков</span>
      </div>
      <div class="header-context">
        <span class="organization-name">{{ organizationName() }}</span>
        <button class="exit-link" (click)="leave()">Выйти</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <nav aria-label="Основное меню">
          <a
            [routerLink]="['/', role(), 'batches']"
            [queryParams]="listQueryParams()"
            [attr.aria-current]="section() === 'batches' ? 'page' : null"
            >▤ Батчи</a
          >
          <a
            [routerLink]="['/', role(), 'streams']"
            [queryParams]="listQueryParams()"
            [attr.aria-current]="section() === 'streams' ? 'page' : null"
            >≋ Стримы</a
          >
          @if (role() === 'team') {
            <a
              routerLink="/team/customers"
              [attr.aria-current]="section() === 'customers' ? 'page' : null"
              >Заказчики</a
            >
          }
          @if (role() === 'customer') {
            <a
              [routerLink]="['/customer/comparison']"
              [queryParams]="listQueryParams()"
              [attr.aria-current]="section() === 'comparison' ? 'page' : null"
              >⇄ Сравнение</a
            >
          }
        </nav>
      </aside>
      <main #main id="main-content" class="main-content" tabindex="-1"><ng-content /></main>
    </div>
  `,
})
export class WorkspaceShell {
  private readonly connection = inject(ApiConnection);
  private readonly router = inject(Router);
  readonly organizationName = input.required<string>();
  readonly role = input.required<'customer' | 'team'>();
  readonly section = input.required<'batches' | 'streams' | 'comparison' | 'customers'>();
  readonly listQueryParams = input<{ organization: string; stream: string } | null>(null);
  protected leave(): void {
    this.connection.clear();
    void this.router.navigate(['/connect']);
  }
}
