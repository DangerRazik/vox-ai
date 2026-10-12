import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BatchSummary } from './report-models';
import { formatNumber } from '../shared/formatting';

@Component({
  selector: 'app-report-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="summary-grid">
      <section class="metric-card" aria-labelledby="average-title">
        <h2 id="average-title">Средняя оценка</h2>
        <p class="metric-value">
          @if (summary().averageTotal === null) {
            <span class="no-data">Нет данных</span>
          } @else {
            {{ number(summary().averageTotal!) }}
            <span class="metric-unit">из {{ summary().maxTotal ?? 11 }}</span>
          }
        </p>
      </section>
      <section class="metric-card" aria-labelledby="success-title">
        <h2 id="success-title">Успешно обработано</h2>
        <p class="metric-value">
          {{ summary().successfulCalls }}
          <span class="metric-unit">из {{ summary().acceptedCalls }}</span>
        </p>
      </section>
      <section class="metric-card" aria-labelledby="critical-title">
        <h2 id="critical-title">Критические нарушения</h2>
        <p class="metric-value">
          @if (criticalDisabled()) {
            <span class="no-data">Отключено</span>
          } @else if (summary().successfulCalls === 0) {
            <span class="no-data">Нет данных</span>
          } @else {
            {{ summary().criticalViolationCount }}
            <span class="metric-unit">из {{ summary().successfulCalls }}</span>
          }
        </p>
        <p class="metric-description">Звонки с нарушением среди успешно обработанных</p>
      </section>
    </div>
    <section class="report-errors" aria-label="Ошибки батча">
      <p>
        <strong>Ошибки загрузки: {{ summary().uploadErrors }}</strong>
        <span>Не входят в {{ summary().acceptedCalls }} принятых записей.</span>
      </p>
      <p>
        <strong>Ошибки обработки: {{ summary().processingErrors }}</strong>
        <span>Относятся к принятым записям; не входят в средние оценки.</span>
      </p>
    </section>
  `,
})
export class ReportSummary {
  readonly summary = input.required<BatchSummary>();
  protected readonly number = formatNumber;
  protected criticalDisabled() {
    return (
      this.summary().maxTotal !== undefined &&
      !Object.hasOwn(this.summary().criterionAverages, '5.2')
    );
  }
}
