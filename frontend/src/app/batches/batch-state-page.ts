import { connectionError } from '../connection/api-connection';
import { BatchProgress } from './batch-progress';
import { TechnicalDetails } from '../shared/technical-details';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  map,
  of,
  startWith,
  Subject,
  switchMap,
  timer,
  filter,
  exhaustMap,
  EMPTY,
} from 'rxjs';
import { ReportShell } from '../shared/report-shell';
import { UploadIntakeResult } from '../uploads/upload-result';
import { reportNavigation } from '../reports/report-navigation';
import { BatchDetailsSource } from './batch-details-source';
import { BatchDetails, BatchDetailsResult, BATCH_STATE_MESSAGES } from './batch-details';
import { BATCH_STATUSES, AccessRole } from './batch-models';
import { RecoveryForm } from '../uploads/recovery-form';
import {
  RestoreRequest,
  UploadFieldError,
  UploadFiles,
  UploadsSource,
} from '../uploads/upload-models';
import { BatchLaunchAction, launchMessage } from './batch-launch-action';
import { StartBatchResult } from './admin-batches-source';

type State = BatchDetailsResult | { kind: 'loading' | 'error' };

@Component({
  selector: 'app-batch-state-page',
  imports: [
    ReportShell,
    BatchProgress,
    TechnicalDetails,
    UploadIntakeResult,
    RouterLink,
    RecoveryForm,
    BatchLaunchAction,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-report-shell
      [role]="role"
      [organizationName]="organizationName()"
      [listQueryParams]="listQuery()"
    >
      <div class="page-heading">
        <div>
          <h1>Состояние батча</h1>
        </div>
        <a class="button secondary" [routerLink]="navigation.batches" [queryParams]="listQuery()"
          >К списку батчей</a
        >
      </div>
      @let view = state();
      @switch (view.kind) {
        @case ('loading') {
          <div class="state-panel" role="status"><h2>Загружаем состояние…</h2></div>
        }
        @case ('error') {
          <div class="state-panel error-panel" role="alert">
            <h2>Не удалось загрузить состояние</h2>
            <button class="button secondary" (click)="reload()">Повторить</button>
          </div>
        }
        @case ('not-found') {
          <div class="state-panel">
            <h2>Батч не найден или недоступен</h2>
            <p>Проверьте адрес или вернитесь к списку.</p>
          </div>
        }
        @case ('available') {
          <section class="upload-panel batch-details" aria-label="Сведения о батче">
            <h2>{{ view.details.batch.name }}</h2>
            <p>
              <span [class]="'status-badge ' + statuses[view.details.batch.status].tone">{{
                statuses[view.details.batch.status].label
              }}</span>
            </p>
            @if (
              ['queued', 'processing', 'completed', 'batch_failed'].includes(
                view.details.batch.status
              )
            ) {
              <app-batch-progress
                [status]="view.details.batch.status"
                [progress]="view.details.processingProgress ?? null"
                [stale]="processingReadError()"
                [canControl]="role === 'team' && !!view.details.processingProgress"
                [locked]="pauseChanging()"
                [error]="pauseError()"
                (pauseChanged)="changePause($event)"
              />
            }
            @if (
              !['queued', 'processing', 'completed', 'upload_failed'].includes(
                view.details.batch.status
              )
            ) {
              <p>{{ messages[view.details.batch.status] }}</p>
            }
            <p>Стрим: {{ view.details.stream.name }}</p>
            @if (view.details.intake; as intake) {
              <app-upload-result [result]="intake" [compact]="true" />
            } @else {
              <p>Принято записей: {{ view.details.batch.acceptedCalls }}</p>
            }

            @if (
              view.details.failure &&
              (view.details.batch.status !== 'upload_failed' ||
                !view.details.intake?.errors?.length)
            ) {
              <p class="field-error">Причина: {{ view.details.failure }}</p>
            }
            @if (view.details.recovery; as progress) {
              <p>Повторно принято: {{ progress.receivedCalls }} из {{ progress.expectedCalls }}</p>
            }
            @if (view.details.batch.status === 'completed') {
              <a
                class="button primary batch-report-button"
                [routerLink]="navigation.batchReport(view.details.batch.id)"
                >Открыть отчёт</a
              >
            } @else if (
              view.details.batch.status === 'queued' || view.details.batch.status === 'processing'
            ) {
              <p class="scope-note">
                Отчёт ещё не опубликован. Оценки появятся после завершения всего батча.
              </p>
            }
            @if (role === 'team') {
              @if (view.details.batch.status === 'ready') {
                <app-batch-launch-action
                  [batch]="view.details.batch"
                  (finished)="launched($event)"
                />
              } @else {
                <details class="request-controls">
                  <summary>Повтор запроса запуска</summary>
                  <p>
                    Запрос возвращает текущее состояние или отказ. Новое задание для уже запущенного
                    батча не создаётся.
                  </p>
                  <app-batch-launch-action
                    [batch]="view.details.batch"
                    [repeat]="true"
                    (finished)="launched($event)"
                  />
                </details>
              }
            }
          </section>
          @if (launchNotice()) {
            <p class="info-note" [attr.role]="launchRefused() ? 'alert' : 'status'">
              {{ launchNotice() }}
            </p>
          }
          @if (restored()) {
            <div class="info-note" role="status">
              <h2 #resultHeading tabindex="-1">Восстановление завершено</h2>
              <p>Тот же батч ожидает ручного запуска команды.</p>
            </div>
          }
          @if (
            role === 'customer' &&
            (view.details.batch.status === 'batch_failed' ||
              view.details.batch.status === 'upload_failed' ||
              view.details.batch.status === 'restoring' ||
              view.details.batch.status === 'uploading')
          ) {
            <app-recovery-form
              [details]="view.details"
              [locked]="request() !== null"
              [error]="formError()"
              [serverError]="fieldError()"
              (edited)="fieldError.set(null)"
              (submitted)="restore($event)"
            >
            </app-recovery-form>
          }
          @if (pending()) {
            <p role="status">Передаём исходные записи…</p>
          }
          @if (requestError()) {
            <div class="state-panel error-panel" role="alert">
              <h2 #errorHeading tabindex="-1">Подтверждение повторной загрузки не получено</h2>
              <p>Файлы и ID сохранены. Повторите ту же передачу.</p>
              @if (progressReadError()) {
                <p>Не удалось обновить прогресс. Отображаются последние известные сведения.</p>
                <button
                  class="button secondary"
                  (click)="refreshProgress()"
                  [disabled]="progressRefreshing()"
                >
                  Обновить сведения о приёме
                </button>
              }
              <button class="button primary" (click)="send()">Повторить передачу</button>
            </div>
          }
          <app-technical-details
            [ids]="[
              { label: 'ID батча', value: view.details.batch.id, testId: 'batch-id' },
              { label: 'ID стрима', value: view.details.stream.id },
              { label: 'ID загрузки', value: view.details.uploadId, testId: 'upload-id' },
            ]"
          />
        }
      }
    </app-report-shell>
  `,
})
export class BatchStatePage {
  private readonly source = inject(BatchDetailsSource);
  private readonly uploads = inject(UploadsSource);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refresh = new Subject<void>();
  protected readonly role = this.route.snapshot.data['role'] as AccessRole;
  protected readonly navigation = reportNavigation(this.role);
  protected readonly state = signal<State>({ kind: 'loading' });
  protected readonly processingReadError = signal(false);
  protected readonly pauseChanging = signal(false);
  protected readonly pauseError = signal('');
  protected changePause(paused: boolean): void {
    const context = this.context();
    if (
      !context ||
      this.role !== 'team' ||
      this.pauseChanging() ||
      context.batch.status !== 'processing'
    )
      return;
    const batchId = context.batch.id;
    this.pauseChanging.set(true);
    this.pauseError.set('');
    this.source
      .setPaused(batchId, paused)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (this.route.snapshot.paramMap.get('batchId') !== batchId) return;
          this.pauseChanging.set(false);
          if (result.kind === 'available') {
            this.context.set(result.details);
            this.processingReadError.set(false);
          }
          this.state.set(result);
        },
        error: (error) => {
          if (this.route.snapshot.paramMap.get('batchId') !== batchId) return;
          this.pauseChanging.set(false);
          this.pauseError.set(
            connectionError(error) + ' Состояние обновится автоматически; запрос можно повторить.',
          );
        },
      });
  }
  protected readonly context = signal<BatchDetails | null>(null);
  protected readonly request = signal<RestoreRequest | null>(null);
  protected readonly pending = signal(false);
  protected readonly launchNotice = signal('');
  protected readonly launchRefused = signal(false);
  protected launched(result: StartBatchResult): void {
    if (
      result.kind !== 'not-found' &&
      result.details.batch.id !== this.route.snapshot.paramMap.get('batchId')
    )
      return;
    this.launchNotice.set(launchMessage(result));
    this.launchRefused.set(result.kind === 'not-found' || result.kind === 'not-ready');
    if (result.kind === 'not-found') {
      this.state.set({ kind: 'not-found' });
      this.context.set(null);
    } else {
      this.context.set(result.details);
      this.state.set({ kind: 'available', details: result.details });
    }
  }
  protected readonly requestError = signal(false);
  protected readonly fieldError = signal<UploadFieldError | null>(null);
  protected readonly formError = signal('');
  protected readonly restored = signal(false);
  protected readonly progressReadError = signal(false);
  protected readonly progressRefreshing = signal(false);
  private readonly resultHeading = viewChild<ElementRef<HTMLHeadingElement>>('resultHeading');
  private readonly errorHeading = viewChild<ElementRef<HTMLHeadingElement>>('errorHeading');
  protected readonly statuses = BATCH_STATUSES;
  protected readonly messages = BATCH_STATE_MESSAGES;
  protected readonly organizationName = computed(
    () =>
      this.context()?.organization.name ?? (this.role === 'team' ? 'Команда Vox AI' : 'Заказчик'),
  );
  protected readonly listQuery = computed(() => {
    const context = this.context();
    return context ? { organization: context.organization.id, stream: context.stream.id } : null;
  });
  constructor() {
    afterRenderEffect(() => {
      if (this.restored()) this.resultHeading()?.nativeElement.focus();
    });
    afterRenderEffect(() => {
      if (this.requestError()) this.errorHeading()?.nativeElement.focus();
    });
    combineLatest([this.route.paramMap, this.refresh.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          const batchId = params.get('batchId') ?? '';
          if (this.context()?.batch.id !== batchId) {
            this.launchNotice.set('');
            this.pauseError.set('');
            this.pauseChanging.set(false);
            this.processingReadError.set(false);
            this.context.set(null);
            this.request.set(null);
            this.pending.set(false);
            this.restored.set(false);
            this.requestError.set(false);
            this.formError.set('');
            this.progressReadError.set(false);
            this.progressRefreshing.set(false);
          }
          this.state.set({ kind: 'loading' });
          return this.source.batchDetails(this.role, batchId).pipe(
            map((result): State => result),
            catchError(() => of<State>({ kind: 'error' })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        if (state.kind === 'available') this.context.set(state.details);
        if (state.kind === 'not-found') this.context.set(null);
        this.state.set(state);
      });
    this.route.paramMap
      .pipe(
        switchMap((params) => {
          const batchId = params.get('batchId') ?? '';
          return timer(5000, 5000).pipe(
            filter(
              () =>
                this.context()?.batch.id === batchId &&
                ['queued', 'processing'].includes(this.context()!.batch.status) &&
                !this.pending() &&
                !this.pauseChanging(),
            ),
            exhaustMap(() =>
              this.source.batchDetails(this.role, batchId).pipe(
                catchError(() => {
                  this.processingReadError.set(true);
                  return EMPTY;
                }),
              ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (
          result.kind === 'available' &&
          result.details.batch.id === this.route.snapshot.paramMap.get('batchId')
        ) {
          this.processingReadError.set(false);
          this.pauseError.set('');
          this.context.set(result.details);
          this.state.set(result);
        }
        if (result.kind === 'not-found') {
          this.context.set(null);
          this.state.set(result);
        }
      });
  }
  protected reload() {
    this.refresh.next();
  }
  protected restore(files: UploadFiles) {
    const context = this.context();
    if (!context || this.request() || this.role !== 'customer') return;
    this.request.set({
      ...files,
      batchId: context.batch.id,
      uploadId: context.uploadId,
      organizationId: context.organization.id,
    });
    this.send();
  }
  protected send() {
    const request = this.request();
    if (!request || this.pending()) return;
    this.pending.set(true);
    this.requestError.set(false);
    this.formError.set('');
    this.fieldError.set(null);
    this.uploads
      .restore(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (this.context()?.batch.id !== request.batchId) return;
          this.context.set(result.details);
          this.state.set({ kind: 'available', details: result.details });
          this.pending.set(false);
          if (result.kind === 'restored') this.restored.set(true);
          else {
            this.formError.set(result.message);
            this.fieldError.set(result.fieldError ?? null);
            this.request.set(null);
          }
        },
        error: () => {
          if (this.context()?.batch.id !== request.batchId) return;
          this.pending.set(false);
          this.requestError.set(true);
          this.refreshProgress();
        },
      });
  }
  protected refreshProgress() {
    const batchId = this.context()?.batch.id;
    if (!batchId || this.progressRefreshing()) return;
    this.progressRefreshing.set(true);
    this.progressReadError.set(false);
    this.source
      .batchDetails(this.role, batchId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (this.context()?.batch.id !== batchId) return;
          this.progressRefreshing.set(false);
          if (result.kind === 'available') {
            this.context.set(result.details);
            if (
              ['ready', 'queued', 'processing', 'completed'].includes(result.details.batch.status)
            ) {
              this.requestError.set(false);
              this.request.set(null);
              this.restored.set(result.details.batch.status === 'ready');
            }
          } else {
            this.context.set(null);
            this.request.set(null);
          }
          this.state.set(result);
        },
        error: () => {
          if (this.context()?.batch.id !== batchId) return;
          this.progressRefreshing.set(false);
          this.progressReadError.set(true);
        },
      });
  }
}
