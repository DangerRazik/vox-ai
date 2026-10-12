import { TestBed } from '@angular/core/testing';
import { ReportBlock } from './report-block';

async function render(defaultExpanded = false) {
  const fixture = TestBed.createComponent(ReportBlock);
  fixture.componentRef.setInput('title', 'Метрики');
  fixture.componentRef.setInput('preferenceKey', 'test');
  fixture.componentRef.setInput('defaultExpanded', defaultExpanded);
  await fixture.whenStable();
  return fixture;
}

describe('Сворачиваемый блок отчёта', () => {
  it('закрыт при открытии отчёта, раскрывается по кнопке и сбрасывает выбор в новом отчёте', async () => {
    const fixture = await render();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('#report-content-test').hidden).toBe(true);
    button.click();
    await fixture.whenStable();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('#report-content-test').hidden).toBe(false);
    fixture.destroy();
    const next = await render();
    expect(next.nativeElement.querySelector('button').getAttribute('aria-expanded')).toBe('false');
  });
  it('позволяет раскрыть оценки по умолчанию и свернуть их вручную', async () => {
    const fixture = await render(true);
    expect(fixture.nativeElement.querySelector('button').getAttribute('aria-expanded')).toBe('true');
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#report-content-test').hidden).toBe(true);
  });
});
