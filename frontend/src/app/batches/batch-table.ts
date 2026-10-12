import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BatchLaunchAction } from './batch-launch-action';
import { StartBatchResult } from './admin-batches-source';
import { Batch, BATCH_STATUSES } from './batch-models';
import { RouterLink } from '@angular/router';
import { formatNumber } from '../shared/formatting';

@Component({
  selector: 'app-batch-table',
  imports: [RouterLink, BatchLaunchAction],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: block; min-width: 0; }',
  template: `
    <div class="table-scroll" role="region" aria-label="Таблица батчей" tabindex="0">
      <table>
        <caption class="sr-only">
          Загрузки выбранного стрима. Оценка доступна только после публикации отчёта.
        </caption>
        <thead>
          <tr>
            <th scope="col">Загрузка</th>
            <th scope="col">Дата, МСК</th>
            <th scope="col">Статус</th>
            <th scope="col" class="numeric">Принято записей</th>
            <th scope="col" class="numeric">Средний балл</th>
            @if (showActions()) {
              <th scope="col">Действие</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (batch of batches(); track batch.id) {
            <tr>
              <th scope="row">
                <span class="batch-name" [title]="batch.uploadId ?? batch.id">{{ batch.name }}</span
                ><span class="filename">{{ batch.filename }}</span>
              </th>
              <td class="date">
                <time [attr.datetime]="batch.createdAt">{{ date(batch.createdAt) }}</time>
              </td>
              <td>
                <span
                  class="status-badge"
                  [class]="'status-badge ' + statuses[batch.status].tone"
                  >{{ statuses[batch.status].label }}</span
                >
              </td>
              <td class="numeric">{{ batch.acceptedCalls }}</td>
              <td class="numeric grade">
                @if (batch.status !== 'completed') {
                  <span class="muted" aria-label="Ещё не опубликован">—</span
                  ><span class="sr-only">Ещё не опубликован</span>
                } @else if (batch.averageTotal === null) {
                  <span class="muted">Нет данных</span>
                } @else {
                  <strong>{{ score(batch.averageTotal) }}</strong
                  ><span class="score-max"> из {{ batch.maxTotal ?? 11 }}</span>
                }
              </td>
              @if (showActions()) {
                <td>
                  <div class="batch-actions">
                    @if (canLaunch() && batch.status === 'ready') {
                      <app-batch-launch-action
                        [batch]="batch"
                        (finished)="launchFinished.emit($event)"
                      />
                    }
                    @if (batch.status === 'completed') {
                      <a [routerLink]="[batch.id, 'report']"
                        >Отчёт<span class="sr-only"> · {{ batch.name }}</span></a
                      >
                    } @else if (!reportsOnly()) {
                      <a [routerLink]="[batch.id, 'state']"
                        >{{
                          batch.status === 'upload_failed' || batch.status === 'batch_failed'
                            ? 'Восстановить'
                            : 'Статус'
                        }}<span class="sr-only"> · {{ batch.name }}</span></a
                      >
                    }
                  </div>
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class BatchTable {
  readonly showActions = input(true);
  readonly canLaunch = input(false);
  readonly reportsOnly = input(false);
  readonly launchFinished = output<StartBatchResult>();
  readonly batches = input.required<readonly Batch[]>();
  protected readonly statuses = BATCH_STATUSES;
  private readonly dates = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
  protected readonly score = formatNumber;

  protected date(value: string): string {
    return this.dates.format(new Date(value));
  }
}
