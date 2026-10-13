import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ProcessingAnalytics as Analytics, ProviderUsage } from './report-models';
import { formatNumber } from '../shared/formatting';

@Component({
  selector: 'app-processing-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="processing-analytics" aria-labelledby="processing-analytics-title">
      <h2 id="processing-analytics-title">Производительность обработки</h2>
      <div class="processing-speed">
        <div>
          <h3>Скорость обработки</h3>
          <p class="processing-speed-value">{{ ratio(analytics()?.speedRatio) }}</p>
        </div>
        <p class="processing-speed-formula">Длительность записей / время обработки</p>
      </div>
      <dl class="processing-stat-grid">
        <div>
          <dt title="Уникальные принятые записи, включая завершившиеся ошибкой обработки">
            Длительность записей
          </dt>
          <dd>{{ duration(analytics()?.totalAudioSeconds) }}</dd>
        </div>
        <div>
          <dt>Время обработки</dt>
          <dd>
            {{ duration(analytics()?.activeDurationSeconds) }}
            <p class="processing-stat-note">Без очереди и ручных пауз</p>
          </dd>
        </div>
        <div class="processing-stat-item">
          <dt>
            Токены Whisper
            <details class="report-error-hint">
              <summary aria-label="О токенах Whisper">ⓘ</summary>
              <p>{{ tokenHint(analytics()?.whisperUsage) }}</p>
            </details>
          </dt>
          <dd>{{ tokens(analytics()?.whisperUsage) }}</dd>
        </div>
        <div class="processing-stat-item">
          <dt>
            Токены LLM
            <details class="report-error-hint">
              <summary aria-label="О токенах LLM">ⓘ</summary>
              <p>Определение ролей и оценка звонков. {{ tokenHint(analytics()?.llmUsage) }}</p>
            </details>
          </dt>
          <dd>{{ tokens(analytics()?.llmUsage) }}</dd>
        </div>
      </dl>
      @if (analytics()?.activeDurationSeconds === null || !analytics()) {
        <p class="processing-stat-note">
          Учёт токенов и активного времени доступен для новых обработок.
        </p>
      }
    </section>
  `,
})
export class ProcessingAnalytics {
  readonly analytics = input<Analytics | null>(null);
  protected ratio(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return 'Не сохранена';
    return value > 0 && value < 0.01 ? '<0,01×' : formatNumber(value) + '×';
  }
  protected duration(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return 'Не сохранено';
    if (value > 0 && value < 0.01) return '<0,01 с';
    const rounded = Math.round(value * 100) / 100;
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor(rounded / 60) % 60;
    const seconds = Math.round((rounded % 60) * 100) / 100;
    return [
      hours ? hours + ' ч' : '',
      minutes ? minutes + ' мин' : '',
      seconds || (!hours && !minutes) ? formatNumber(seconds) + ' с' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  protected tokens(usage: ProviderUsage | null | undefined): string {
    if (!usage) return 'Не сохранены';
    if (usage.totalTokens !== null) return formatNumber(usage.totalTokens);
    return usage.reportedTokens > 0
      ? '≥ ' + formatNumber(usage.reportedTokens)
      : 'Не предоставлены';
  }
  protected tokenHint(usage: ProviderUsage | null | undefined): string {
    if (!usage) return 'Расход не записывался при этой обработке.';
    if (usage.unreportedRequests)
      return `Провайдер не сообщил расход в ${usage.unreportedRequests} запросах. Если часть расхода известна, показана её сумма.`;
    return 'Сумма входящих и исходящих токенов, сообщённых провайдером в usage ответов.';
  }
}
