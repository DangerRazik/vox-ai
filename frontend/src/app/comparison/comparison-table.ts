import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CRITERIA, BatchSummary } from '../reports/report-models';
import { formatNumber } from '../shared/formatting';
import { ComparisonColumn } from './comparison-models';

@Component({
  selector: 'app-comparison-table',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="report-table-panel">
      <div class="table-scroll" role="region" aria-label="Таблица сравнения" tabindex="0">
        <table class="comparison-table" [style.min-width.px]="260 + columns().length * 220">
          <caption class="sr-only">
            Показатели выбранных батчей
          </caption>
          <thead>
            <tr>
              <th scope="col">Показатель</th>
              @for (column of columns(); track column.batch.id) {
                <th scope="col">
                  <a [routerLink]="reportLink(column.batch.id)">{{ column.batch.name }}</a>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of summaryRows; track row.field) {
              <tr>
                <th scope="row">
                  {{
                    row.field === 'averageTotal'
                      ? 'Средняя оценка, из ' + (columns()[0]?.summary?.maxTotal ?? 11)
                      : row.label
                  }}
                </th>
                @for (column of columns(); track column.batch.id) {
                  <td>
                    @if (row.field === 'criticalViolationCount') {
                      @if (column.summary.maxTotal !== undefined && !hasCritical(column.summary)) {
                        Отключено
                      } @else if (column.summary.successfulCalls === 0) {
                        Нет данных
                      } @else {
                        {{ column.summary.criticalViolationCount }} из
                        {{ column.summary.successfulCalls }}
                      }
                    } @else {
                      {{ display(column.summary[row.field]) }}
                    }
                  </td>
                }
              </tr>
            }
            <tr>
              <td class="comparison-section" [attr.colspan]="columns().length + 1">
                Средние исходные оценки критериев, из 1
              </td>
            </tr>
            @for (criterion of selectedCriteria(); track criterion.id) {
              <tr>
                <th scope="row">{{ criterion.id }} · {{ criterion.name }}</th>
                @for (column of columns(); track column.batch.id) {
                  <td>{{ display(column.summary.criterionAverages[criterion.id]) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class ComparisonTable {
  readonly columns = input.required<readonly ComparisonColumn[]>();
  readonly batchesPath = input<readonly string[]>(['/demo/customer/batches']);
  protected reportLink(batchId: string): string[] {
    return [...this.batchesPath(), batchId, 'report'];
  }
  protected readonly criteria = CRITERIA;
  protected readonly summaryRows: readonly {
    field: keyof Omit<BatchSummary, 'criterionAverages' | 'maxTotal'>;
    label: string;
  }[] = [
    { field: 'averageTotal', label: 'Средняя оценка, из 11' },
    { field: 'acceptedCalls', label: 'Принято записей' },
    { field: 'successfulCalls', label: 'Успешно обработано' },
    { field: 'uploadErrors', label: 'Ошибки загрузки' },
    { field: 'processingErrors', label: 'Ошибки обработки' },
    { field: 'criticalViolationCount', label: 'Критические нарушения, из успешных звонков' },
  ];
  protected display(value: number | null): string {
    return value === null ? 'Нет данных' : formatNumber(value);
  }
  protected selectedCriteria() {
    return this.criteria.filter((c) =>
      Object.hasOwn(this.columns()[0]?.summary.criterionAverages ?? {}, c.id),
    );
  }
  protected hasCritical(summary: BatchSummary) {
    return Object.hasOwn(summary.criterionAverages, '5.2');
  }
}
