import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ComparisonColumn } from './comparison-models';
import { ComparisonTable } from './comparison-table';

const critical: ComparisonColumn = {
  batch: {
    id: 'critical',
    organizationId: 'example',
    streamId: 'rules',
    name: 'Нулевой итог',
    filename: 'critical.zip',
    createdAt: '2026-10-01T06:00:00Z',
    status: 'completed',
    acceptedCalls: 1,
    averageTotal: 0,
  },
  summary: {
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
  },
};
const noResults: ComparisonColumn = {
  batch: { ...critical.batch, id: 'empty', name: 'Нет результатов', averageTotal: null },
  summary: {
    ...critical.summary,
    successfulCalls: 0,
    processingErrors: 1,
    averageTotal: null,
    criticalViolationCount: 0,
    criticalViolationRate: null,
    criterionAverages: {
      '1.1': null,
      '1.2': null,
      '2.1': null,
      '2.2': null,
      '2.3': null,
      '2.4': null,
      '3.1': null,
      '3.2': null,
      '4.1': null,
      '5.1': null,
      '5.2': null,
    },
  },
};
async function render(columns: readonly ComparisonColumn[]): Promise<HTMLElement> {
  await TestBed.configureTestingModule({
    imports: [ComparisonTable],
    providers: [provideRouter([])],
  }).compileComponents();
  const fixture = TestBed.createComponent(ComparisonTable);
  fixture.componentRef.setInput('columns', columns);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
function cells(element: HTMLElement, label: string): string[] {
  const row = [...element.querySelectorAll('tbody tr')].find(
    (row) => row.querySelector('th')?.textContent?.trim() === label,
  )!;
  return [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim());
}
describe('Таблица сравнения опубликованных сводок', () => {
  it('сравнивает только выбранные критерии и использует максимум стрима', async () => {
    const column: ComparisonColumn = {
      ...critical,
      summary: {
        ...critical.summary,
        maxTotal: 1,
        averageTotal: 0.5,
        criterionAverages: { '1.1': 0.5 } as ComparisonColumn['summary']['criterionAverages'],
      },
    };
    const element = await render([column, { ...column, batch: { ...column.batch, id: 'second' } }]);
    expect(cells(element, 'Средняя оценка, из 1')).toEqual(['0,5', '0,5']);
    expect(cells(element, '1.1 · Приветствие')).toEqual(['0,5', '0,5']);
    expect(element.textContent).not.toContain('5.2 · Критическое нарушение');
    expect(cells(element, 'Критические нарушения, из успешных звонков')).toEqual([
      'Отключено',
      'Отключено',
    ]);
  });
  it('различает нулевые значения и отсутствие данных, сохраняя исходные оценки', async () => {
    const element = await render([critical, noResults]);
    expect(cells(element, 'Средняя оценка, из 11')).toEqual(['0', 'Нет данных']);
    expect(cells(element, 'Критические нарушения, из успешных звонков')).toEqual([
      '1 из 1',
      'Нет данных',
    ]);
    expect(element.textContent).not.toContain('%');
    expect(cells(element, '1.1 · Приветствие')).toEqual(['1', 'Нет данных']);
    expect(cells(element, '5.2 · Критическое нарушение')).toEqual(['0', 'Нет данных']);
  });
  it('сохраняет порядок переданных колонок и ссылки на соответствующие отчёты', async () => {
    const element = await render([noResults, critical]);
    const links = [...element.querySelectorAll('thead a')];
    expect(links.map((link) => link.textContent!.trim())).toEqual([
      'Нет результатов',
      'Нулевой итог',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/customer/batches/empty/report',
      '/customer/batches/critical/report',
    ]);
  });
});
