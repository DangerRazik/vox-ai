import { TestBed } from '@angular/core/testing';
import { CriterionChart } from './criterion-chart';
import { BatchSummary } from './report-models';

const summary: BatchSummary = {
  maxTotal: 3,
  acceptedCalls: 4,
  successfulCalls: 4,
  processingErrors: 0,
  uploadErrors: 0,
  averageTotal: 1.5,
  criticalViolationCount: 0,
  criticalViolationRate: 0,
  criterionAverages: { '1.1': 0, '1.2': null, '2.1': 0.625 } as BatchSummary['criterionAverages'],
};
describe('Графики готовых оценок', () => {
  it('показывает выбранные критерии, различает ноль и отсутствие данных', async () => {
    const fixture = TestBed.createComponent(CriterionChart);
    fixture.componentRef.setInput('summary', summary);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const rows = [...element.querySelectorAll('li')];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Приветствие');
    expect(rows[0].querySelector<HTMLElement>('.chart-bar-fill')!.style.width).toBe('0%');
    expect(rows[1].textContent).toContain('Нет данных');
    expect(rows[1].querySelector('.chart-bar-fill')).toBeNull();
    expect(rows[2].textContent).toContain('0,63');
    expect(rows[2].querySelector<HTMLElement>('.chart-bar-fill')!.style.width).toBe('62.5%');
  });
});
