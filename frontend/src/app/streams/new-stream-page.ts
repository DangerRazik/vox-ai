import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, forkJoin, of, startWith, Subject, switchMap } from 'rxjs';
import { Organization } from '../batches/batch-models';
import { CustomersSource } from '../customers/customers-source';
import { ReportShell } from '../shared/report-shell';
import { reportNavigation } from '../reports/report-navigation';
import { adminOperationError } from '../connection/admin-operation-error';
import { AdminStream, AdminStreamsSource } from './admin-streams-source';
import { StreamForm, StreamFormValue } from './stream-form';
import { DemoAdminStreamsControls } from './demo-admin-streams-controls';

@Component({
  selector: 'app-new-stream-page',
  imports: [ReportShell, RouterLink, StreamForm, DemoAdminStreamsControls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-report-shell
      [demo]="navigation.demo"
      role="team"
      activeSection="streams"
      [organizationName]="organization()?.name ?? organizationId()"
      [listQueryParams]="{ organization: organizationId(), stream: '' }"
    >
      <div class="page-heading">
        <div>
          <h1>Новый стрим</h1>
        </div>
        <a
          class="button secondary"
          [routerLink]="navigation.streams"
          [queryParams]="{ organization: organizationId() }"
          >К списку стримов</a
        >
      </div>
      @if (state() === 'loading') {
        <div class="state-panel" role="status"><h2>Загружаем настройки…</h2></div>
      } @else if (state() === 'error') {
        <div class="state-panel error-panel" role="alert">
          <h2>Не удалось загрузить настройки</h2>
          <button class="button secondary" (click)="load()">Повторить</button>
        </div>
      } @else if (!organization()) {
        <div class="state-panel">
          <h2>Заказчик не найден</h2>
          <p>Выберите организацию в списке стримов.</p>
        </div>
      } @else if (basedOn() && !baseStream()) {
        <div class="state-panel">
          <h2>Исходный стрим не найден</h2>
          <p>Создание на основе недоступного стрима невозможно. Выберите другой стрим в списке.</p>
        </div>
      } @else {
        @if (baseStream(); as base) {
          <p class="info-note">
            На основе «{{ base.name }}». Выберите файлы заново: база знаний и
            включённые словари обязательны. Сведения о прежних материалах не заменяют файлы. Старые
            настройки и история останутся под прежним ID.
          </p>
        }
        <app-stream-form
          [initialConfiguration]="baseStream()"
          [initialWhisperPrompt]="defaultWhisperPrompt()"
          [demo]="navigation.demo"
          [locked]="creating()"
          [requestError]="error()"
          (submitted)="create($event)"
        />
        @if (navigation.demo) {
          <app-demo-admin-streams-controls operation="create" [locked]="creating()" />
        }
      }
    </app-report-shell>
  `,
})
export class NewStreamPage {
  private readonly customers = inject(CustomersSource);
  protected readonly navigation = reportNavigation(
    'team',
    inject(ActivatedRoute).snapshot.data['mode'] === 'rest',
  );
  private readonly source = inject(AdminStreamsSource);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly organization = signal<Organization | null>(null);
  protected readonly organizationId = signal('');
  protected readonly basedOn = signal('');
  protected readonly defaultWhisperPrompt = signal('');
  protected readonly baseStream = signal<AdminStream | null>(null);
  protected readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly creating = signal(false);
  protected readonly error = signal('');
  private readonly reloads = new Subject<void>();
  private contextVersion = 0;
  constructor() {
    combineLatest([this.route.queryParamMap, this.reloads.pipe(startWith(undefined))])
      .pipe(
        switchMap(([query]) => {
          this.contextVersion++;
          this.creating.set(false);
          this.error.set('');
          this.state.set('loading');
          const organizationId = query.get('organization') ?? '';
          const basedOn = query.get('basedOn') ?? '';
          this.organizationId.set(organizationId);
          this.basedOn.set(basedOn);
          this.organization.set(null);
          this.baseStream.set(null);
          this.defaultWhisperPrompt.set('');
          return forkJoin({
            organizations: this.customers.list(),
            defaults: basedOn ? of(null) : this.source.creationDefaults(),
            baseStream: basedOn ? this.source.details(organizationId, basedOn) : of(null),
          }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result) {
          this.organization.set(
            result.organizations.find((org) => org.id === this.organizationId()) ?? null,
          );
          this.baseStream.set(result.baseStream);
          this.defaultWhisperPrompt.set(result.defaults?.whisperPrompt ?? '');
        }
        this.state.set(result ? 'ready' : 'error');
      });
  }
  protected load(): void {
    this.reloads.next();
  }
  protected create(value: StreamFormValue): void {
    const organization = this.organization();
    if (!organization || this.creating()) return;
    const version = this.contextVersion;
    this.creating.set(true);
    this.error.set('');
    this.source
      .create({ ...value, organizationId: organization.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stream) => {
          if (version !== this.contextVersion) return;
          void this.router.navigate(this.navigation.streamDetails(stream.id), {
            queryParams: { organization: stream.organizationId },
          });
        },
        error: (error) => {
          if (version !== this.contextVersion) return;
          this.creating.set(false);
          this.error.set(
            this.navigation.demo
              ? 'Не удалось создать стрим. Настройки и выбранные файлы сохранены; повторите попытку.'
              : adminOperationError(error),
          );
        },
      });
  }
}
