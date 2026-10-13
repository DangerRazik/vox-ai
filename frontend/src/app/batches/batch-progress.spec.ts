import { TestBed } from '@angular/core/testing';
import { BatchProgress } from './batch-progress';
import { BatchStatus } from './batch-models';

async function render(status: BatchStatus, processedCalls = 6, totalCalls = 10) {
  const fixture = TestBed.createComponent(BatchProgress);
  fixture.componentRef.setInput('status', status);
  fixture.componentRef.setInput('progress', { processedCalls, totalCalls });
  await fixture.whenStable();
  return fixture;
}

describe('Прогресс батча', () => {
  it('показывает фактический процент законченных записей', async () => {
    const fixture = await render('processing');
    expect(fixture.nativeElement.textContent).toContain('Обработано 6 из 10');
    expect(fixture.nativeElement.querySelector('progress').value).toBe(60);
  });
  it('ожидание очереди не имеет выдуманного процента', async () => {
    const fixture = await render('queued', 0);
    expect(fixture.nativeElement.textContent).toContain('Ожидает начала обработки');
    expect(fixture.nativeElement.querySelector('progress')).toBeNull();
  });
  it('последний звонок не означает опубликованный отчёт', async () => {
    const fixture = await render('processing', 10);
    expect(fixture.nativeElement.textContent).toContain('Сохраняем результаты');
    expect(fixture.nativeElement.querySelector('progress').value).toBe(99);
    fixture.componentRef.setInput('status', 'completed');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('progress').value).toBe(100);
  });
  it('отсутствующий счётчик не становится ложным процентом', async () => {
    const fixture = await render('processing');
    fixture.componentRef.setInput('progress', null);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('progress').hasAttribute('value')).toBe(false);
  });
});

it('управление паузой доступно только при разрешении и отправляет продолжение отдельно', async () => {
  const fixture = await render('processing');
  const actions: boolean[] = [];
  fixture.componentInstance.pauseChanged.subscribe((value) => actions.push(value));
  expect(fixture.nativeElement.querySelector('button')).toBeNull();
  fixture.componentRef.setInput('canControl', true);
  await fixture.whenStable();
  fixture.nativeElement.querySelector('button').click();
  expect(actions).toEqual([true]);
  fixture.componentRef.setInput('progress', {
    processedCalls: 6,
    totalCalls: 10,
    paused: true,
    pauseRequested: true,
  });
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('На паузе');
  expect(fixture.nativeElement.querySelector('button').textContent).toContain('Продолжить');
  fixture.nativeElement.querySelector('button').click();
  expect(actions).toEqual([true, false]);
  fixture.componentRef.setInput('locked', true);
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
});
