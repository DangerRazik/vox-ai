import { Injectable } from '@angular/core';
import { CRITERIA } from '../reports/report-models';
import { AdminStream } from './admin-streams-source';

export const DEMO_WHISPER_PROMPT =
  'Демонстрационный промпт: распознай разговор с временными границами реплик.';

const seed = (id: string, organizationId: string, name: string): AdminStream => ({
  id,
  organizationId,
  name,
  createdAt: '2026-10-01T06:00:00Z',
  whisperPrompt: DEMO_WHISPER_PROMPT,
  llmPrompt: 'Демонстрационный промпт: оцени работу сотрудника по 11 фиксированным критериям.',
  options: {
    tempoAnalysis: id !== 'support-incoming',
    unwantedExpressions: id !== 'new-project',
    textCorrections: id === 'incoming',
    zeroTotalOnCritical: id !== 'support-incoming',
  },
  criteria: CRITERIA,
  materials: {
    knowledgeBase: { name: 'demo-knowledge.html', size: 256, type: 'text/html' },
    unwantedExpressions:
      id === 'new-project' ? null : { name: 'demo-unwanted.txt', size: 64, type: 'text/plain' },
    textCorrections:
      id === 'incoming'
        ? { name: 'demo-corrections.json', size: 64, type: 'application/json' }
        : null,
  },
});

@Injectable({ providedIn: 'root' })
export class DemoStreamCatalog {
  private streams: readonly AdminStream[] = [
    seed('incoming', 'contact-center', 'Входящие обращения'),
    seed('outgoing', 'contact-center', 'Исходящие обращения'),
    seed('new-project', 'contact-center', 'Новый проект'),
    seed('support-incoming', 'support', 'Поддержка клиентов'),
  ];
  all(): readonly AdminStream[] {
    return this.streams;
  }
  add(stream: AdminStream): void {
    this.streams = [...this.streams, stream];
  }
  remove(streamId: string): void {
    this.streams = this.streams.filter((stream) => stream.id !== streamId);
  }
}
