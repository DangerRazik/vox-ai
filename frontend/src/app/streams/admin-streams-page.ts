import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap } from 'rxjs';
import { Organization } from '../batches/batch-models';
import { CustomersSource } from '../customers/customers-source';
import { ReportShell } from '../shared/report-shell';
import { reportNavigation } from '../reports/report-navigation';
import { AdminStream, AdminStreamsSource } from './admin-streams-source';
import { DemoAdminStreamsControls } from './demo-admin-streams-controls';

@Component({
  selector: 'app-admin-streams-page',
  imports: [ReportShell, RouterLink, DemoAdminStreamsControls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-report-shell
      [demo]="navigation.demo"
      role="team"
      activeSection="streams"
      [organizationName]="organization()?.name ?? ''"
      [listQueryParams]="{ organization: organization()?.id ?? '', stream: '' }"
    >
      <div class="page-heading">
        <div>
          <h1>Стримы заказчика</h1>
          <p class="page-description">Фиксированные правила обработки звонков</p>
        </div>
        @if (state() === 'ready' && organization()) {
          <a
            class="button primary"
            [routerLink]="navigation.newStream"
            [queryParams]="{ organization: organization()!.id }"
            >Создать стрим</a
          >
        }
      </div>
      @if (organizations().length) {
        <div class="filter-bar">
          <div class="field">
            <label for="stream-organization">Организация</label
            ><select
              id="stream-organization"
              #org
              [value]="organization()?.id ?? ''"
              (change)="selectOrganization(org.value)"
            >
              @for (item of organizations(); track item.id) {
                <option [value]="item.id" [selected]="item.id === organization()?.id">
                  {{ item.name }}
                </option>
              }
            </select>
          </div>
        </div>
      }
      @if (state() === 'loading') {
        <div class="state-panel" role="status"><h2>Загружаем стримы…</h2></div>
      } @else if (state() === 'error') {
        <div class="state-panel error-panel" role="alert">
          <h2>Не удалось загрузить стримы</h2>
          <button class="button secondary" (click)="reload()">Повторить</button>
        </div>
      } @else if (!streams().length) {
        <div class="state-panel">
          <h2>Пока нет стримов</h2>
          <p>Создайте правила обработки для выбранного заказчика.</p>
        </div>
      } @else {
        <div class="streams-list">
          @for (stream of streams(); track stream.id) {
            <article class="stream-card">
              <h2>{{ stream.name }}</h2>

              <p class="page-description">
                Готов к использованию · критериев: {{ stream.criteria.length }}
              </p>
              <a
                class="button secondary"
                [routerLink]="navigation.streamDetails(stream.id)"
                [queryParams]="{ organization: stream.organizationId }"
                >Просмотреть стрим</a
              >
            </article>
          }
        </div>
      }
      @if (navigation.demo) {
        <app-demo-admin-streams-controls
          [locked]="state() === 'loading'"
          (reloadRequested)="reload()"
        />
      }
    </app-report-shell>
  `,
})
export class AdminStreamsPage {
  protected readonly navigation = reportNavigation(
    'team',
    inject(ActivatedRoute).snapshot.data['mode'] === 'rest',
  );
  private readonly source = inject(AdminStreamsSource);
  private readonly customers = inject(CustomersSource);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<void>();
  protected readonly organizations = signal<readonly Organization[]>([]);
  protected readonly organization = signal<Organization | null>(null);
  protected readonly streams = signal<readonly AdminStream[]>([]);
  protected readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  constructor() {
    combineLatest([this.route.queryParamMap, this.reads.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          this.state.set('loading');
          this.streams.set([]);
          return this.customers.list().pipe(
            switchMap((organizations) => {
              this.organizations.set(organizations);
              const organization =
                organizations.find((item) => item.id === params.get('organization')) ??
                organizations[0] ??
                null;
              this.organization.set(organization);
              return organization ? this.source.list(organization.id) : of([]);
            }),
            map((streams) => ({ streams, state: 'ready' as const })),
            catchError(() => of({ streams: [], state: 'error' as const })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.streams.set(result.streams);
        this.state.set(result.state);
      });
  }
  protected selectOrganization(id: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { organization: id } });
  }
  protected reload(): void {
    this.reads.next();
  }
}
