import { TechnicalDetails } from '../shared/technical-details';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PROCESSING_FIELDS } from './stream-processing';
import { AdminStream } from './admin-streams-source';
import { formatFileSize } from '../shared/formatting';

@Component({
  selector: 'app-stream-snapshot',
  imports: [TechnicalDetails],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="snapshot-title" class="stream-snapshot">
      <header class="snapshot-heading">
        <h2 id="snapshot-title">{{ stream().name }}</h2>

      </header>
      <section class="stream-card">
        <h3>1. Транскрибация через Whisper</h3>
        <h4>Промпт Whisper</h4>
        <p class="snapshot-prompt">{{ stream().whisperPrompt || 'Не задан' }}</p>
      </section>
      <section class="stream-card">
        <h3>2. Обработка транскрипции</h3>
        @if (stream().processing; as processing) {
          @for (field of fields(2); track field.key) {
            <h4>{{ field.label }}</h4>
            <p>{{ number(processing[field.key]) }}</p>
          }
        }
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
        </dl>
        @for (material of dictionaries(); track material.label) {
          <h4>{{ material.label }}</h4>
          <p class="material-metadata">
            {{
              material.file
                ? material.file.name + ' · ' + fileSize(material.file.size)
                : 'Не используется: опция выключена'
            }}
          </p>
        }
      </section>
      <section class="stream-card">
        <h3>3. Анализ с помощью LLM</h3>
        <h4>База знаний</h4>
        <p class="material-metadata">
          {{ stream().materials.knowledgeBase.name }} ·
          {{ fileSize(stream().materials.knowledgeBase.size) }}
        </p>
        <h4>Обнуление итога при критическом нарушении</h4>
        <p>{{ stream().options.zeroTotalOnCritical ? 'Включено' : 'Выключено' }}</p>
        <h4>Критерии оценки · {{ stream().criteria.length }}</h4>
        <ol>
          @for (criterion of stream().criteria; track criterion.id) {
            <li>{{ criterion.id }} · {{ criterion.name }}</li>
          }
        </ol>
        <app-technical-details [ids]="[{ label: 'ID стрима', value: stream().id }]" />
      </section>
    </section>
  `,
})
export class StreamSnapshot {
  protected readonly fileSize = formatFileSize;
  protected fields(stage: number) {
    return PROCESSING_FIELDS.filter((f) => f.stage === stage);
  }
  protected number(value: string | number) {
    return typeof value === 'number' ? String(value).replace('.', ',') : value;
  }
  readonly stream = input.required<AdminStream>();
  protected dictionaries() {
    return [
      {
        label: 'Словарь нежелательных выражений',
        file: this.stream().materials.unwantedExpressions,
      },
      { label: 'Словарь корректировки текста', file: this.stream().materials.textCorrections },
    ];
  }
}
