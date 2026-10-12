import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, forkJoin, of, startWith, Subject, switchMap } from 'rxjs';
import { Organization } from '../batches/batch-models';
import { CustomersSource } from '../customers/customers-source';
import { ReportShell } from '../shared/report-shell';
import { reportNavigation } from '../reports/report-navigation';
import { connectionError } from '../connection/api-connection';
import { AdminStream, AdminStreamsSource } from './admin-streams-source';
import { StreamSnapshot } from './stream-snapshot';
import { DeleteStreamConfirmation } from './delete-stream-confirmation';

@Component({
  selector: 'app-admin-stream-details-page',
  imports: [DatePipe, ReportShell, RouterLink, StreamSnapshot, DeleteStreamConfirmation],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-report-shell
      role="team"
      activeSection="streams"
      [organizationName]="organization()?.name ?? organizationId()"
      [listQueryParams]="{ organization: organizationId(), stream: stream()?.id ?? '' }"
    >
      <div class="page-heading stream-details-heading">
        <div>
          <h1 #pageTitle tabindex="-1">Просмотр стрима</h1>
          @if (stream(); as item) {
            <p class="page-description">
              Создан {{ item.createdAt | date: 'dd.MM.yyyy HH:mm' : 'UTC' }} UTC
            </p>
          }
        </div>
        <a
          class="button secondary"
          [routerLink]="navigation.streams"
          [queryParams]="{ organization: organizationId() }"
          >К списку стримов</a
        >
      </div>
      @if (state() === 'loading') {
        <div class="state-panel" role="status"><h2>Загружаем снимок стрима…</h2></div>
      } @else if (state() === 'error') {
        <div class="state-panel error-panel" role="alert">
          <h2>Не удалось загрузить снимок стрима</h2>
          <button class="button secondary" (click)="reload()">Повторить</button>
        </div>
      } @else if (deletedName()) {
        <div class="state-panel" role="status">
          <h2>Стрим удалён</h2>
          <p>
            «{{ deletedName() }}»: его батчи, транскрипции и история удалены. Данные других стримов
            сохранены.
          </p>
        </div>
      } @else if (stream(); as item) {
        <app-stream-snapshot [stream]="item">
          <a
            snapshot-action
            class="button secondary"
            [routerLink]="navigation.newStream"
            [queryParams]="{ organization: item.organizationId, basedOn: item.id }"
            >Создать на основе стрима</a
          >
        </app-stream-snapshot>
        <div class="page-actions">
          <button type="button" class="button danger" (click)="deleteTarget.set(item)">
            Удалить стрим
          </button>
          <a
            class="button secondary"
            [routerLink]="navigation.batches"
            [queryParams]="{ organization: item.organizationId, stream: item.id }"
            >Открыть батчи</a
          >
        </div>
      } @else {
        <div class="state-panel">
          <h2>Стрим не найден</h2>
          <p>Стрим недоступен для выбранной организации.</p>
        </div>
      }

      @if (deleteTarget(); as target) {
        <app-delete-stream-confirmation
          [stream]="target"
          [locked]="deleting()"
          [requestError]="deleteError()"
          (confirmed)="confirmDelete()"
          (cancelled)="cancelDelete()"
        />
      }
    </app-report-shell>
  `,
})
export class AdminStreamDetailsPage {
  protected readonly navigation = reportNavigation('team');
  private readonly source = inject(AdminStreamsSource);
  private readonly customers = inject(CustomersSource);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<void>();
  private readonly pageTitle = viewChild.required<ElementRef<HTMLHeadingElement>>('pageTitle');
  protected readonly organization = signal<Organization | null>(null);
  protected readonly organizationId = signal('');
  protected readonly stream = signal<AdminStream | null>(null);
  protected readonly deleteTarget = signal<AdminStream | null>(null);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');
  protected readonly deletedName = signal('');
  protected readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  constructor() {
    afterNextRender(() => this.pageTitle().nativeElement.focus());
    afterRenderEffect(() => {
      if (this.deletedName()) this.pageTitle().nativeElement.focus();
    });
    combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
      this.reads.pipe(startWith(undefined)),
    ])
      .pipe(
        switchMap(([params, query]) => {
          this.deleteTarget.set(null);
          this.deleting.set(false);
          this.deleteError.set('');
          this.state.set('loading');
          this.stream.set(null);
          this.deletedName.set('');
          const organizationId = query.get('organization') ?? '';
          this.organizationId.set(organizationId);
          this.organization.set(null);
          return forkJoin({
            organizations: this.customers.list(),
            stream: this.source.details(organizationId, params.get('streamId') ?? ''),
          }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result) {
          this.stream.set(result.stream);
          this.organization.set(
            result.organizations.find((org) => org.id === this.organizationId()) ?? null,
          );
        }
        this.state.set(result ? 'ready' : 'error');
      });
  }
  protected reload(): void {
    this.reads.next();
  }
  protected cancelDelete(): void {
    this.deleteTarget.set(null);
    this.deleteError.set('');
  }
  protected confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set('');
    this.source
      .delete(target.organizationId, target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (this.deleteTarget() !== target) return;
          this.deleting.set(false);
          if (result.kind === 'busy') {
            this.deleteError.set(result.message);
            return;
          }
          this.deleteTarget.set(null);
          this.stream.set(null);
          if (result.kind === 'deleted') this.deletedName.set(target.name);
        },
        error: (error) => {
          if (this.deleteTarget() !== target) return;
          this.deleting.set(false);
          this.deleteError.set(
            connectionError(error) + ' Подтверждение сохранено; повторите или отмените удаление.',
          );
        },
      });
  }
}
