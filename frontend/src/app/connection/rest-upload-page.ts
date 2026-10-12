import { TechnicalDetails } from '../shared/technical-details';
import { createUuid } from '../shared/uuid';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Stream } from '../batches/batch-models';
import { ZipUploadForm } from '../uploads/zip-upload-form';
import { UploadIntakeResult } from '../uploads/upload-result';
import {
  UploadFiles,
  UploadRequest,
  UploadResult,
  UploadFieldError,
} from '../uploads/upload-models';
import { ApiConnection } from './api-connection';
import { RestBatchesCatalog } from './rest-catalog';
import {
  editableUploadError,
  RestUploadsSource,
  uploadErrorMessage,
  uploadFieldError,
} from './rest-uploads-source';
import { WorkspaceShell } from './workspace-shell';

interface UploadDraft {
  uploadId: string;
  streamId: string;
}
const openStatuses = new Set(['uploading', 'upload_failed', 'restoring', 'batch_failed']);

@Component({
  selector: 'app-rest-upload-page',
  imports: [RouterLink, WorkspaceShell, ZipUploadForm, UploadIntakeResult, TechnicalDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-workspace-shell
      role="customer"
      [organizationName]="owner.name"
      section="batches"
      [listQueryParams]="{ organization: owner.id, stream: streamId() }"
    >
      <div class="page-heading">
        <h1>Загрузка ZIP</h1>
        <a
          class="button secondary"
          routerLink="/customer/batches"
          [queryParams]="{ stream: streamId() }"
          >К списку батчей</a
        >
      </div>
      @if (loading()) {
        <p role="status">Загружаем стримы…</p>
      } @else if (contextError()) {
        <p role="alert">Не удалось загрузить стримы.</p>
        <button class="button secondary" (click)="load()">Повторить</button>
      } @else {
        @if (resumed() && !closed() && !result()) {
          <p class="info-note">
            Продолжаем прежнюю загрузку. Файлы после обновления страницы нужно выбрать заново;
            идентификатор и стрим сохранены.
          </p>
        }
        @if (result(); as intake) {
          <app-upload-result [result]="intake" />
        }
        @if (error() && !fieldError()) {
          <div class="upload-error" role="alert">
            <h2>Не удалось завершить загрузку</h2>
            <p>{{ error() }}</p>
            @if (uncertain()) {
              <p>Сначала проверьте состояние загрузки. Её идентификатор сохранён.</p>
              <button class="button secondary" [disabled]="busy()" (click)="check()">
                Проверить состояние
              </button>
            } @else if (request() && !closed()) {
              <button class="button primary" [disabled]="busy()" (click)="send()">
                Повторить приём
              </button>
            }
          </div>
        }
        @if (!streams().length) {
          <p>Нет доступных стримов. Обратитесь к команде Vox AI.</p>
        } @else if (!closed()) {
          @for (session of [uploadId()]; track session) {
            <app-zip-upload-form
              [streams]="streams()"
              [initialStreamId]="streamId()"
              [fixedStream]="draftSaved()"
              [serverError]="fieldError()"
              (edited)="fieldError.set(null); error.set('')"
              submitLabel="Загрузить"
              [locked]="busy() || uncertain() || request() !== null"
              (submitted)="start($event)"
            />
          }
        }
        @if (busy()) {
          <p role="status">
            {{ checking() ? 'Проверяем фактическое состояние…' : 'Передаём архив…' }}
          </p>
        }
        @if (result() || (!busy() && !uncertain() && draftSaved())) {
          <div class="upload-actions">
            @if (result(); as intake) {
              <a
                class="button secondary"
                [routerLink]="['/customer/batches', intake.batch.id, 'state']"
                >Состояние батча</a
              >
            }
            @if (!busy() && !uncertain() && draftSaved()) {
              <button class="button secondary" (click)="newUpload()">
                {{ closed() ? 'Загрузить ещё ZIP' : 'Начать новую загрузку' }}
              </button>
            }
          </div>
        }
        <app-technical-details
          [ids]="[
            { label: 'ID загрузки', value: uploadId(), testId: 'upload-id' },
            { label: 'ID стрима', value: streamId() },
          ]"
        />
      }
    </app-workspace-shell>
  `,
})
export class RestUploadPage {
  private readonly connection = inject(ApiConnection);
  private readonly catalog = inject(RestBatchesCatalog);
  private readonly source = inject(RestUploadsSource);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly owner = this.connection.access()!.organization!;
  private readonly storagePrefix =
    'vox-upload-draft:' + JSON.stringify([this.connection.address, this.owner.id]);
  private storageKey(uploadId = this.uploadId()): string {
    return this.storagePrefix + ':' + uploadId;
  }
  protected readonly uploadId = signal<string>(createUuid());
  protected readonly streamId = signal('');
  protected readonly streams = signal<readonly Stream[]>([]);
  protected readonly loading = signal(true);
  protected readonly contextError = signal(false);
  protected readonly busy = signal(false);
  protected readonly checking = signal(false);
  protected readonly uncertain = signal(false);
  protected readonly resumed = signal(false);
  protected readonly draftSaved = signal(false);
  protected readonly fieldError = signal<UploadFieldError | null>(null);
  protected readonly error = signal('');
  protected readonly request = signal<UploadRequest | null>(null);
  protected readonly result = signal<UploadResult | null>(null);
  protected closed(): boolean {
    return !!this.result() && !openStatuses.has(this.result()!.batch.status);
  }
  constructor() {
    this.load();
  }
  protected load(): void {
    this.loading.set(true);
    this.contextError.set(false);
    this.catalog
      .streams(this.owner.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: async (streams) => {
          this.streams.set(streams);
          const requestedUpload = this.route.snapshot.queryParamMap.get('upload');
          const sessionId =
            requestedUpload && /^[0-9a-f-]{36}$/i.test(requestedUpload)
              ? requestedUpload
              : this.uploadId();
          this.uploadId.set(sessionId);
          const draft = this.readDraft(sessionId);
          const requested = this.route.snapshot.queryParamMap.get('stream');
          this.streamId.set(
            draft?.streamId ?? streams.find((s) => s.id === requested)?.id ?? streams[0]?.id ?? '',
          );
          try {
            await this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { stream: this.streamId(), upload: sessionId },
              replaceUrl: true,
            });
            if (this.destroyRef.destroyed) return;
          } catch {
            this.contextError.set(true);
            this.loading.set(false);
            return;
          }
          this.loading.set(false);
          if (draft) {
            this.uploadId.set(draft.uploadId);
            this.draftSaved.set(true);
            this.resumed.set(true);
            this.uncertain.set(true);
            this.check();
          }
        },
        error: () => {
          this.contextError.set(true);
          this.loading.set(false);
        },
      });
  }
  private readDraft(uploadId: string): UploadDraft | null {
    try {
      const draft = JSON.parse(
        localStorage.getItem(this.storageKey(uploadId)) ?? 'null',
      ) as UploadDraft | null;
      return draft &&
        typeof draft.uploadId === 'string' &&
        draft.uploadId === uploadId &&
        typeof draft.streamId === 'string'
        ? draft
        : null;
    } catch {
      return null;
    }
  }
  protected start(files: UploadFiles): void {
    if (this.busy() || this.uncertain() || this.request()) return;
    if (this.draftSaved() && files.streamId !== this.streamId()) return;
    try {
      localStorage.setItem(
        this.storageKey(),
        JSON.stringify({ uploadId: this.uploadId(), streamId: files.streamId }),
      );
    } catch {
      this.error.set(
        'Браузер не позволяет сохранить идентификатор загрузки. Разрешите локальное хранение и повторите отправку.',
      );
      return;
    }
    this.streamId.set(files.streamId);
    this.draftSaved.set(true);
    this.request.set({ ...files, organizationId: this.owner.id, uploadId: this.uploadId() });
    this.send();
  }
  protected send(): void {
    const request = this.request();
    if (!request || this.busy() || this.uncertain()) return;
    this.busy.set(true);
    this.error.set('');
    this.fieldError.set(null);
    this.source
      .upload(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.busy.set(false);
          if (!this.closed()) this.request.set(null);
        },
        error: (error) => {
          this.error.set(uploadErrorMessage(error));
          this.busy.set(false);
          if (editableUploadError(error)) {
            this.request.set(null);
            this.fieldError.set(uploadFieldError(error));
          } else {
            this.uncertain.set(true);
            this.check();
          }
        },
      });
  }
  protected check(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.checking.set(true);
    this.source
      .lookup(this.owner.id, this.streamId(), this.uploadId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.busy.set(false);
          this.checking.set(false);
          this.uncertain.set(false);
          if (result) this.request.set(null);
          if (this.closed()) {
            this.error.set('');
            this.request.set(null);
          } else
            this.error.set(
              result
                ? ''
                : 'Сервер не нашёл эту загрузку. Можно повторить передачу с прежним идентификатором.',
            );
        },
        error: (error) => {
          this.error.set(uploadErrorMessage(error));
          this.busy.set(false);
          this.checking.set(false);
          this.uncertain.set(true);
        },
      });
  }
  protected async newUpload(): Promise<void> {
    if (this.busy() || this.uncertain()) return;
    const uploadId = createUuid();
    this.busy.set(true);
    try {
      const navigated = await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { stream: this.streamId(), upload: uploadId },
        replaceUrl: true,
      });
      if (!navigated || this.destroyRef.destroyed) return;
    } catch {
      this.error.set('Не удалось открыть новую загрузку. Повторите попытку.');
      return;
    } finally {
      this.busy.set(false);
    }
    this.fieldError.set(null);
    this.uploadId.set(uploadId);
    this.draftSaved.set(false);
    this.resumed.set(false);
    this.request.set(null);
    this.result.set(null);
    this.error.set('');
  }
}
