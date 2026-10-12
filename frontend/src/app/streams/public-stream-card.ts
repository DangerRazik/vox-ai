import { TechnicalDetails } from '../shared/technical-details';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicStream } from './public-streams-source';

@Component({
  selector: 'app-public-stream-card',
  imports: [DatePipe, RouterLink, TechnicalDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: block; min-width: 0; }',
  template: `
    <article class="report-section stream-card" [attr.aria-labelledby]="'stream-' + stream().id">
      <div class="page-heading">
        <div>
          <h2 [id]="'stream-' + stream().id">{{ stream().name }}</h2>

          <p class="page-description">
            Создан {{ stream().createdAt | date: 'dd.MM.yyyy' : 'UTC' }}
          </p>
          @if (selected()) {
            <p class="selected-stream">Выбран для батчей</p>
          }
        </div>
        <a
          class="button secondary"
          [routerLink]="batchesPath()"
          [queryParams]="{ organization: stream().organizationId, stream: stream().id }"
          >Открыть батчи</a
        >
      </div>

      <h3>Публичные опции</h3>
      <dl class="stream-options">
        <div>
          <dt>Анализ темпа речи</dt>
          <dd>{{ stream().options.tempoAnalysis ? 'Включено' : 'Выключено' }}</dd>
        </div>
        <div>
          <dt>Поиск нежелательных выражений</dt>
          <dd>{{ stream().options.unwantedExpressions ? 'Включено' : 'Выключено' }}</dd>
        </div>
        <div>
          <dt>Корректировка текста транскрипции</dt>
          <dd>{{ stream().options.textCorrections ? 'Включено' : 'Выключено' }}</dd>
        </div>
        <div>
          <dt>Обнуление итога при критическом нарушении</dt>
          <dd>{{ stream().options.zeroTotalOnCritical ? 'Включено' : 'Выключено' }}</dd>
        </div>
      </dl>
      <details class="stream-criteria">
        <summary>Критерии оценки · {{ stream().criteria.length }}</summary>
        <ul>
          @for (criterion of stream().criteria; track criterion.id) {
            <li>{{ criterion.id }} · {{ criterion.name }}</li>
          }
        </ul>
      </details>
      <app-technical-details [ids]="[{ label: 'ID стрима', value: stream().id }]" />
    </article>
  `,
})
export class PublicStreamCard {
  readonly stream = input.required<PublicStream>();
  readonly batchesPath = input.required<readonly string[]>();
  readonly selected = input(false);
}
