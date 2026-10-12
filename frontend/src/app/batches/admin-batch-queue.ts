import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of, Subject, switchMap } from 'rxjs';
import { AdminBatchesSource, BatchQueue } from './admin-batches-source';
import { DemoQueueControls } from './demo-queue-controls';

@Component({
  selector: 'app-admin-batch-queue',
  imports: [RouterLink, DemoQueueControls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin-top: 24px;
      min-width: 0;
    }
    ol {
      display: grid;
      gap: 8px;
      padding-left: 24px;
    }
    li {
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <section class="stream-card" aria-label="Общая очередь батчей">
      <h2>Общая очередь</h2>
      <p class="section-description">
        Демо всех организаций · FIFO по времени ручного запуска. Одновременно обрабатывается один
        батч.
      </p>
      @if (loading()) {
        <p role="status">Читаем общую очередь…</p>
      } @else if (queue(); as data) {
        @if (data.processing; as active) {
          <div role="region" aria-label="Обрабатываемый батч">
            <p>
              Обрабатывается:
              <a [routerLink]="['/demo/team/batches', active.batch.id, 'state']">{{
                active.batch.name
              }}</a>
              · {{ active.organization.name }}
            </p>
          </div>
        } @else {
          <p>Сейчас нет обрабатываемого батча.</p>
        }
        <h3>Ожидают начала обработки</h3>
        @if (data.waiting.length) {
          <ol>
            @for (item of data.waiting; track item.batch.id) {
              <li>
                <a [routerLink]="['/demo/team/batches', item.batch.id, 'state']">{{
                  item.batch.name
                }}</a>
                · {{ item.organization.name }} · {{ item.stream.name }}
              </li>
            }
          </ol>
        } @else {
          <p>Очередь пуста.</p>
        }
      } @else {
        <p role="alert">Не удалось прочитать очередь.</p>
        <button class="button secondary" (click)="load()">Повторить чтение очереди</button>
      }
      <app-demo-queue-controls
        [empty]="loading() || (!queue()?.processing && !queue()?.waiting?.length)"
        (changed)="changed()"
        (readRequested)="load()"
      />
    </section>
  `,
})
export class AdminBatchQueue {
  readonly refresh = input(0);
  readonly changedRequested = output<void>();
  protected readonly queue = signal<BatchQueue | null>(null);
  protected readonly loading = signal(true);
  private readonly source = inject(AdminBatchesSource);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<void>();
  constructor() {
    this.reads
      .pipe(
        switchMap(() => {
          this.loading.set(true);
          return this.source.queue().pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((queue) => {
        this.queue.set(queue);
        this.loading.set(false);
      });
    effect(() => {
      this.refresh();
      this.load();
    });
  }
  protected load(): void {
    this.reads.next();
  }
  protected changed(): void {
    this.load();
    this.changedRequested.emit();
  }
}
