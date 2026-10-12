import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReportBlock } from './report-block';

describe('Сворачиваемый блок отчёта', () => {
  afterEach(() => {
    localStorage.removeItem('vox.report-block.test');
    vi.restoreAllMocks();
  });
  async function render() {
    const fixture = TestBed.createComponent(ReportBlock);
    fixture.componentRef.setInput('title', 'Метрики');
    fixture.componentRef.setInput('preferenceKey', 'test');
    await fixture.whenStable();
    return fixture;
  }
  it('открыт по умолчанию, сворачивается и восстанавливает выбор в новом отчёте', async () => {
    const fixture = await render();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.click();
    await fixture.whenStable();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('#report-content-test').hidden).toBe(true);
    fixture.destroy();
    const next = await render();
    expect(next.nativeElement.querySelector('button').getAttribute('aria-expanded')).toBe('false');
    next.nativeElement.querySelector('button').click();
    await next.whenStable();
    expect(next.nativeElement.querySelector('#report-content-test').hidden).toBe(false);
  });
  it('остаётся доступным, когда браузер запрещает сохранение настроек', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const fixture = await render();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('button').getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});
