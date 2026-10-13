import { TestBed } from '@angular/core/testing';
import { ProcessingAnalytics } from './processing-analytics';
import { ProcessingAnalytics as Analytics } from './report-models';

const metrics: Analytics = {
  totalAudioSeconds: 600,
  activeDurationSeconds: 150,
  speedRatio: 4,
  whisperUsage: { requests: 2, totalTokens: 300, reportedTokens: 300, unreportedRequests: 0 },
  llmUsage: { requests: 4, totalTokens: 2500, reportedTokens: 2500, unreportedRequests: 0 },
};
async function render(analytics: Analytics | null) {
  const fixture = TestBed.createComponent(ProcessingAnalytics);
  fixture.componentRef.setInput('analytics', analytics);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
function metric(element: HTMLElement, title: string) {
  return [...element.querySelectorAll('dt')]
    .find((x) => x.textContent!.trim().startsWith(title))!
    .closest('div')!;
}

describe('Производительность батча', () => {
  it('показывает коэффициент и длительности в понятных единицах', async () => {
    const element = await render(metrics);
    expect(element.querySelector('.processing-speed-value')!.textContent).toBe('4×');
    expect(metric(element, 'Длительность записей').textContent).toContain('10 мин');
    expect(metric(element, 'Время обработки').textContent).toContain('2 мин 30 с');
    expect(metric(element, 'Токены Whisper').querySelector('dd')!.textContent).toBe('300');
    expect(metric(element, 'Токены LLM').querySelector('dd')!.textContent).toMatch(/2\s500/);
  });
  it('отличает неучтённые старые данные от отсутствующих usage провайдера', async () => {
    const element = await render({
      ...metrics,
      activeDurationSeconds: null,
      speedRatio: null,
      whisperUsage: null,
      llmUsage: { requests: 2, totalTokens: null, reportedTokens: 0, unreportedRequests: 2 },
    });
    expect(element.querySelector('.processing-speed-value')!.textContent).toBe('Не сохранена');
    expect(metric(element, 'Токены Whisper').querySelector('dd')!.textContent).toBe('Не сохранены');
    expect(metric(element, 'Токены LLM').querySelector('dd')!.textContent).toBe('Не предоставлены');
  });
  it('частично известный расход не выдаёт за полный', async () => {
    const element = await render({
      ...metrics,
      llmUsage: { requests: 3, totalTokens: null, reportedTokens: 300, unreportedRequests: 1 },
    });
    expect(metric(element, 'Токены LLM').querySelector('dd')!.textContent).toContain('≥ 300');
  });
});
