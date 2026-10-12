import { TechnicalDetails } from '../shared/technical-details';
import { createUuid } from '../shared/uuid';
import {
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
import { switchMap } from 'rxjs';
import { BatchesSource } from '../batches/batches-source';
import { Stream } from '../batches/batch-models';
import { DemoShell } from '../shared/demo-shell';
import { DemoIntakeControls } from './demo-intake-controls';
import { UploadFiles, UploadRequest, UploadResult, UploadsSource } from './upload-models';
import { ZipUploadForm } from './zip-upload-form';
import { UploadIntakeResult } from './upload-result';

@Component({
  selector: 'app-upload-page',
  imports: [DemoShell, RouterLink, ZipUploadForm, UploadIntakeResult, DemoIntakeControls, TechnicalDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-demo-shell
      role="customer"
      [organizationName]="organizationName()"
      [listQueryParams]="listQuery()"
    >
      <div class="page-heading">
        <div>
          <h1>Загрузка ZIP</h1>
        </div>
        <a class="button secondary" routerLink="/demo/customer/batches" [queryParams]="listQuery()"
          >К списку батчей</a
        >
      </div>
      <p class="info-note">
        Локальная имитация. Выбранный архив не распаковывается. Имена файлов и результаты ниже
        условные. Файлы никуда не отправляются. Новые батчи сохраняются до перезагрузки страницы.
      </p>
      @if (contextState() === 'loading') {
        <p role="status">Загружаем стримы…</p>
      } @else if (contextState() === 'error') {
        <div class="state-panel" role="alert">
          <h2>Не удалось загрузить стримы</h2>
          <button class="button secondary" (click)="loadContext()">Повторить</button>
        </div>
      } @else if (!streams().length) {
        <div class="state-panel">
          <h2>Нет доступных стримов</h2>
          <p>Для загрузки нужен стрим организации.</p>
        </div>
      } @else {

        @if (result(); as intake) {
          <p class="upload-identity">
            Загрузка: {{ intake.batch.filename }} · Стрим: {{ streamName() }}
          </p>
          <app-upload-result [result]="intake" />
        } @else {
          <section class="upload-panel" aria-label="Форма загрузки">
            @for (session of [uploadId()]; track session) {
              <app-zip-upload-form
                [streams]="streams()"
                [initialStreamId]="selectedStream()"
                [locked]="request() !== null"
                [focusOnReady]="focusNewForm()"
                (submitted)="start($event)"
              />
            }
            <app-demo-intake-controls [locked]="request() !== null" />
          </section>
        }
        @if (pending()) {
          <p role="status">Имитируем приём…</p>
        }
        @if (error()) {
          <div class="state-panel error-panel" role="alert">
            <h2 #errorHeading tabindex="-1">Подтверждение приёма не получено</h2>
            <p>
              Файлы и идентификатор сохранены. Повтор отправляет тот же запрос и не создаёт ещё один
              батч.
            </p>
            <button class="button primary" (click)="send()">Повторить приём</button>
          </div>
        }
        @if (!pending() && request()) {
          <button class="button secondary" (click)="newUpload()">
            {{ result() ? 'Загрузить ещё ZIP' : 'Начать новую загрузку' }}
          </button>
        }
        <app-technical-details [ids]="[{ label: 'ID загрузки', value: uploadId(), testId: 'upload-id' }]" />
      }
    </app-demo-shell>
  `,
})
export class UploadPage {
  private readonly source = inject(UploadsSource);
  private readonly batches = inject(BatchesSource);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly organizationId = signal('');
  protected readonly organizationName = signal('');
  protected readonly streams = signal<readonly Stream[]>([]);
  protected readonly selectedStream = signal('');
  protected readonly contextState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly uploadId = signal(createUuid());
  protected readonly request = signal<UploadRequest | null>(null);
  protected readonly result = signal<UploadResult | null>(null);
  protected readonly pending = signal(false);
  protected readonly error = signal(false);
  protected readonly focusNewForm = signal(false);
  private readonly errorHeading = viewChild<ElementRef<HTMLHeadingElement>>('errorHeading');
  constructor() {
    this.loadContext();
    afterRenderEffect(() => {
      if (this.error()) this.errorHeading()?.nativeElement.focus();
    });
  }
  protected listQuery() {
    return { organization: this.organizationId(), stream: this.selectedStream() };
  }
  protected streamName() {
    return this.streams().find((stream) => stream.id === this.selectedStream())?.name ?? '';
  }
  protected loadContext() {
    this.contextState.set('loading');
    this.batches
      .workspace('customer')
      .pipe(
        switchMap((workspace) => {
          const organization = workspace.organizations[0];
          if (!organization) throw new Error('Организация недоступна');
          this.organizationId.set(organization.id);
          this.organizationName.set(organization.name);
          return this.batches.streams(organization.id);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (streams) => {
          this.streams.set(streams);
          const requested = this.route.snapshot.queryParamMap.get('stream');
          this.selectedStream.set(
            streams.find((item) => item.id === requested)?.id ?? streams[0]?.id ?? '',
          );
          this.contextState.set('ready');
        },
        error: () => this.contextState.set('error'),
      });
  }
  protected start(files: UploadFiles) {
    if (this.request()) return;
    this.selectedStream.set(files.streamId);
    this.request.set({
      ...files,
      organizationId: this.organizationId(),
      uploadId: this.uploadId(),
    });
    this.send();
  }
  protected send() {
    const request = this.request();
    if (!request || this.pending()) return;
    this.pending.set(true);
    this.error.set(false);
    this.source
      .upload(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.result.set(result);
          this.pending.set(false);
        },
        error: () => {
          this.error.set(true);
          this.pending.set(false);
        },
      });
  }
  protected newUpload() {
    this.focusNewForm.set(true);
    this.result.set(null);
    this.request.set(null);
    this.error.set(false);
    this.uploadId.set(createUuid());
  }
}
