import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BatchSummary, CRITERIA } from './report-models';
import { formatNumber } from '../shared/formatting';

@Component({
  selector: 'app-criterion-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="chart-panel criterion-chart" aria-label="График оценок критериев">
      <figcaption>Средние оценки критериев</figcaption>
      <ul class="chart-bars">
        @for (row of rows(); track row.id) {
          <li>
            <span class="chart-bar-label">{{ row.id }} · {{ row.name }}</span>
            <span class="chart-bar-track" aria-hidden="true">
              @if (row.value !== null) {
                <span class="chart-bar-fill" [style.width.%]="row.value * 100"></span>
              }
            </span>
            <span class="chart-bar-value">{{
              row.value === null ? 'Нет данных' : number(row.value)
            }}</span>
          </li>
        }
      </ul>
    </figure>
  `,
})
export class CriterionChart {
  readonly summary = input.required<BatchSummary>();
  protected readonly number = formatNumber;
  protected readonly rows = computed(() =>
    CRITERIA.filter((c) => Object.hasOwn(this.summary().criterionAverages, c.id)).map((c) => ({
      ...c,
      value: this.summary().criterionAverages[c.id],
    })),
  );
}
