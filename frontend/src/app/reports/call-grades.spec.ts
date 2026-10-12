import { TestBed } from '@angular/core/testing';
import { CallAssessment, CRITERIA, CriterionExplanation, CriterionId } from './report-models';
import { CallGrades } from './call-grades';

const sample: CallAssessment = {
  scores: {
    '1.1': 1,
    '1.2': 1,
    '2.1': 1,
    '2.2': 1,
    '2.3': 1,
    '2.4': 1,
    '3.1': 1,
    '3.2': 1,
    '4.1': 1,
    '5.1': 1,
    '5.2': 0,
  },
  total: 0,
  zeroTotalOnCritical: true,
  tempoAnalysisEnabled: true,
  criticalReason: 'Оскорбление клиента.',
  explanations: Object.fromEntries(
    CRITERIA.map(({ id }) => [id, { text: 'Пояснение оценки.', applicable: true }]),
  ) as Record<CriterionId, CriterionExplanation>,
};
async function render(assessment: CallAssessment | null): Promise<HTMLElement> {
  await TestBed.configureTestingModule({ imports: [CallGrades] }).compileComponents();
  const fixture = TestBed.createComponent(CallGrades);
  fixture.componentRef.setInput('assessment', assessment);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
describe('Исходные оценки звонка', () => {
  it('показывает только выбранные критерии и максимум из результата', async () => {
    const element = await render({
      ...sample,
      total: 0.5,
      maxTotal: 1,
      scores: { '1.1': 0.5 } as CallAssessment['scores'],
      explanations: {
        '1.1': { text: 'Частично', applicable: true },
      } as CallAssessment['explanations'],
    });
    expect(element.querySelectorAll('details')).toHaveLength(1);
    expect(element.querySelector('[aria-label="Итоговая оценка"]')?.textContent).toMatch(
      /0,5\s+из 1/,
    );
    expect(element.querySelector('[aria-label="Критическое нарушение"]')).toBeNull();
  });
  it('при критическом нарушении объясняет нулевой итог и сохраняет исходные баллы', async () => {
    const element = await render(sample);
    expect(element.textContent).toContain('Итог обнулён');
    expect(element.textContent).toContain('Оскорбление клиента.');
    expect(element.querySelector('[aria-label="Итоговая оценка"]')?.textContent).toMatch(
      /0\s+из 11/,
    );
    expect(element.querySelector('details[aria-label="Приветствие"]')?.textContent).toContain(
      '1 из 1',
    );
    expect(
      element.querySelector('details[aria-label="Критическое нарушение"]')?.textContent,
    ).toContain('0 из 1');
    expect(element.querySelectorAll('details')).toHaveLength(11);
  });

  it('сохраняет нарушение и опубликованную сумму при выключенном обнулении', async () => {
    const element = await render({ ...sample, total: 10, zeroTotalOnCritical: false });
    expect(element.textContent).toContain('Обнуление отключено');
    expect(element.textContent).not.toContain('Итог обнулён');
    expect(element.querySelector('[aria-label="Итоговая оценка"]')?.textContent).toMatch(
      /10\s+из 11/,
    );
    expect(
      element.querySelector('details[aria-label="Критическое нарушение"]')?.textContent,
    ).toContain('0 из 1');
  });
  it('отображает половинный балл и не объявляет нарушение при оценке 5.2 = 1', async () => {
    const element = await render({
      ...sample,
      total: 9.5,
      scores: { ...sample.scores, '1.2': 0.5, '2.3': 0.5, '5.1': 0.5, '5.2': 1 },
      criticalReason: null,
    });
    expect(element.querySelector('details[aria-label="Прощание"]')?.textContent).toContain(
      '0,5 из 1',
    );
    expect(element.querySelector('section[aria-label="Критическое нарушение"]')).toBeNull();
    expect(element.querySelector('[aria-label="Итоговая оценка"]')?.textContent).toMatch(
      /9,5\s+из 11/,
    );
  });
  it('раскрывает пояснение неприменимого критерия без изменения оценки', async () => {
    const element = await render({
      ...sample,
      explanations: {
        ...sample.explanations,
        '4.1': { applicable: false, text: 'Удержание не использовалось.' },
      },
    });
    const detail = element.querySelector<HTMLDetailsElement>(
      'details[aria-label="Постановка/снятие удержания"]',
    )!;
    expect(detail.open).toBe(false);
    detail.querySelector('summary')!.click();
    expect(detail.open).toBe(true);
    expect(detail.textContent).toContain('Критерий неприменим');
    expect(detail.textContent).toContain('Оценка 1 по умолчанию');
    expect(detail.textContent).toContain('Удержание не использовалось.');
    expect(detail.querySelector('summary')?.textContent).toContain('1 из 1');
  });
  it('объясняет оценку 1 при отключённом анализе темпа', async () => {
    const element = await render({ ...sample, tempoAnalysisEnabled: false });
    const detail = element.querySelector('details[aria-label="Темп разговора"]')!;
    expect(detail.textContent).toContain('Анализ темпа отключён в стриме');
    expect(detail.querySelector('summary')?.textContent).toContain('1 из 1');
  });
  it('не создаёт оценок при отсутствии результата', async () => {
    const absent = await render(null);
    expect(absent.textContent).toContain('Оценки недоступны');
    expect(absent.querySelectorAll('details')).toHaveLength(0);
    expect(absent.textContent).not.toContain('0 из 11');
  });
  it('не выдумывает отсутствующее пояснение', async () => {
    const element = await render({
      ...sample,
      explanations: { ...sample.explanations, '1.1': { applicable: true, text: null } },
    });
    expect(element.querySelector('details[aria-label="Приветствие"]')?.textContent).toContain(
      'Пояснение отсутствует.',
    );
  });
});
