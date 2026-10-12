import { TestBed } from '@angular/core/testing';
import { BatchSummary } from './report-models';
import { ReportSummary } from './report-summary';

const sample: BatchSummary = {
  acceptedCalls: 1,
  successfulCalls: 1,
  processingErrors: 0,
  uploadErrors: 2,
  averageTotal: 0,
  criticalViolationCount: 1,
  criticalViolationRate: 1,
  criterionAverages: {
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
};
async function render(summary: BatchSummary): Promise<HTMLElement> {
  await TestBed.configureTestingModule({ imports: [ReportSummary] }).compileComponents();
  const fixture = TestBed.createComponent(ReportSummary);
  fixture.componentRef.setInput('summary', summary);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
function region(element: HTMLElement, title: string): HTMLElement {
  const heading = [...element.querySelectorAll('h2')].find((item) => item.textContent === title);
  return heading!.closest('section')!;
}
describe('Показатели сводного отчёта', () => {
  it('показывает выбранный максимум и отключённую проверку нарушений', async () => {
    const element = await render({
      ...sample,
      maxTotal: 1,
      averageTotal: 0.5,
      criterionAverages: { '1.1': 0.5 } as BatchSummary['criterionAverages'],
    });
    expect(region(element, 'Средняя оценка').textContent).toMatch(/0,5\s+из 1/);
    expect(region(element, 'Критические нарушения').textContent).toContain('Отключено');
  });
  it('показывает один звонок с нарушением из четырёх успешных, исключая ошибки', async () => {
    const element = await render({
      ...sample,
      acceptedCalls: 6,
      successfulCalls: 4,
      processingErrors: 2,
      criticalViolationCount: 1,
      criticalViolationRate: 0.25,
    });
    expect(region(element, 'Критические нарушения').textContent).toMatch(/1\s+из 4/);
    expect(region(element, 'Критические нарушения').textContent).not.toContain('25%');
  });
  it('показывает успешный нулевой итог и число нарушений среди успешных звонков', async () => {
    const element = await render(sample);
    expect(region(element, 'Средняя оценка').textContent).toMatch(/0\s+из 11/);
    expect(region(element, 'Критические нарушения').textContent).toMatch(/1\s+из 1/);
    expect(element.textContent).not.toContain('Нет данных');
  });
  it('отличает отсутствие успешных результатов от нулевого среднего и доли', async () => {
    const element = await render({
      ...sample,
      successfulCalls: 0,
      processingErrors: 1,
      averageTotal: null,
      criticalViolationCount: 0,
      criticalViolationRate: null,
    });
    expect(region(element, 'Средняя оценка').textContent).toContain('Нет данных');
    expect(region(element, 'Критические нарушения').textContent).toContain('Нет данных');
    expect(region(element, 'Успешно обработано').textContent).toMatch(/0\s+из 1/);
    expect(element.textContent).toContain('Ошибки обработки: 1');
  });
  it('показывает нулевую долю при успешных звонках без нарушений', async () => {
    const element = await render({
      ...sample,
      averageTotal: 11,
      criticalViolationCount: 0,
      criticalViolationRate: 0,
    });
    expect(region(element, 'Критические нарушения').textContent).toMatch(/0\s+из 1/);
    expect(region(element, 'Критические нарушения').textContent).not.toContain('Нет данных');
  });
  it('отображает опубликованные показатели и разные уровни ошибок без пересчёта', async () => {
    const element = await render({
      ...sample,
      acceptedCalls: 90,
      successfulCalls: 80,
      averageTotal: 9.65,
      criticalViolationCount: 2,
      criticalViolationRate: 0.025,
      uploadErrors: 10,
      processingErrors: 10,
    });
    expect(region(element, 'Средняя оценка').textContent).toMatch(/9,65\s+из 11/);
    expect(region(element, 'Критические нарушения').textContent).toMatch(/2\s+из 80/);
    expect(region(element, 'Критические нарушения').textContent).not.toContain('%');
    expect(element.textContent).toContain('Не входят в 90 принятых записей');
    expect(element.textContent).toContain('Ошибки загрузки: 10');
    expect(element.textContent).toContain('Ошибки обработки: 10');
  });
});

it('при отсутствии ошибок скрывает сведения об ошибках', async () => {
  const element = await render({ ...sample, uploadErrors: 0, processingErrors: 0 });
  expect(element.textContent).not.toContain('Ошибок загрузки и обработки нет');
  expect(element.querySelector('.report-errors')).toBeNull();
  expect(element.querySelector('details')).toBeNull();
});

it('показывает только ненулевой счётчик и раскрываемое пояснение', async () => {
  const element = await render(sample);
  expect(element.textContent).toContain('Ошибки загрузки: 2');
  expect(element.textContent).not.toContain('Ошибки обработки: 0');
  const hint = element.querySelector('details')!;
  expect(hint.open).toBe(false);
  hint.querySelector('summary')!.click();
  expect(hint.open).toBe(true);
  expect(hint.textContent).toContain('Не входят в 1 принятых записей');
});
