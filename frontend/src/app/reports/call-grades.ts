import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CallAssessment, CRITERIA } from './report-models';
import { formatNumber } from '../shared/formatting';
import { ReportBlock } from './report-block';

@Component({
  selector: 'app-call-grades',
  imports: [ReportBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let result = assessment();
    @if (result === null) {
      <p class="section-description">Оценки недоступны.</p>
    } @else {
      <section class="call-total" aria-label="Итоговая оценка">
        <h2>Итоговая оценка</h2>
        <p class="metric-value">
          {{ number(result.total) }} <span class="metric-unit">из {{ result.maxTotal ?? 11 }}</span>
        </p>
      </section>
      @if (result.scores['5.2'] === 0) {
        <section class="critical-note" aria-label="Критическое нарушение">
          <h2>Критическое нарушение</h2>
          <p>{{ result.criticalReason ?? 'Причина нарушения не указана.' }}</p>
          @if (result.zeroTotalOnCritical) {
            <p>
              <strong>Итог обнулён</strong> по правилу стрима. Исходные оценки критериев сохранены.
            </p>
          } @else {
            <p>
              Обнуление отключено в стриме. Итог равен сумме исходных оценок; факт нарушения
              сохраняется.
            </p>
          }
        </section>
      }
      <app-report-block title="Исходные оценки критериев" preferenceKey="criteria">
        <p class="section-description">Раскройте критерий, чтобы прочитать пояснение.</p>
        @for (criterion of selectedCriteria(result); track criterion.id) {
          <details class="criterion-detail" [attr.aria-label]="criterion.name">
            <summary>
              <span class="criterion-name"
                ><span class="criterion-id">{{ criterion.id }}</span
                >{{ criterion.name }}</span
              ><span class="criterion-score">{{ number(result.scores[criterion.id]) }} из 1</span>
            </summary>
            <div class="criterion-explanation">
              @if (!result.explanations[criterion.id].applicable) {
                <p>Критерий неприменим к этому разговору. Оценка 1 по умолчанию.</p>
              }
              @if (criterion.id === '2.2' && !result.tempoAnalysisEnabled) {
                <p>Анализ темпа отключён в стриме. Оценка 1 по умолчанию.</p>
              }
              <p>{{ result.explanations[criterion.id].text ?? 'Пояснение отсутствует.' }}</p>
            </div>
          </details>
        }
      </app-report-block>
    }
  `,
})
export class CallGrades {
  readonly assessment = input.required<CallAssessment | null>();
  protected readonly criteria = CRITERIA;
  protected selectedCriteria(result: CallAssessment) {
    return this.criteria.filter((c) => Object.hasOwn(result.scores, c.id));
  }
  protected readonly number = formatNumber;
}
