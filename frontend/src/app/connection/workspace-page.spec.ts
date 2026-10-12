import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, vi } from 'vitest';
import { WorkspacePage } from './workspace-page';
import { ApiConnection } from './api-connection';
import { RestBatchesCatalog } from './rest-catalog';
import { Batch } from '../batches/batch-models';

describe('Автоматическое обновление списка батчей', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('обновляет строки без скрытия таблицы, сохраняет фильтр, отменяет запрос при смене стрима и уходе', async () => {
    const pending = new Subject<readonly Batch[]>();
    const batch: Batch = {
      id: 'b1',
      organizationId: 'o1',
      streamId: 's1',
      name: 'Загрузка тест',
      filename: '',
      createdAt: '2026-10-08T00:00:00Z',
      status: 'processing',
      acceptedCalls: 4,
      averageTotal: null,
    };
    const batches = vi
      .fn()
      .mockReturnValueOnce(of([batch]))
      .mockReturnValueOnce(pending)
      .mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [WorkspacePage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { section: 'batches' }, queryParamMap: { get: () => null } },
          },
        },
        {
          provide: ApiConnection,
          useValue: {
            access: () => ({ role: 'customer', organization: { id: 'o1', name: 'Заказчик' } }),
          },
        },
        {
          provide: RestBatchesCatalog,
          useValue: {
            workspace: () => of({ organizations: [{ id: 'o1', name: 'Заказчик' }] }),
            streams: () =>
              of([
                { id: 's1', name: 'Первый', organizationId: 'o1' },
                { id: 's2', name: 'Второй', organizationId: 'o1' },
              ]),
            batches,
          },
        },
      ],
    }).compileComponents();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(WorkspacePage);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).not.toContain('Обновить список');
    const table = element.querySelector('table');
    expect(table!.textContent).toContain('Обрабатывается');
    const status = element.querySelector<HTMLSelectElement>('#workspace-status')!;
    status.value = 'processing';
    status.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(10_000);
    fixture.detectChanges();
    expect(element.querySelector('table')).toBe(table);
    expect(element.textContent).not.toContain('Загружаем данные');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(batches).toHaveBeenCalledTimes(2);
    pending.next([{ ...batch, acceptedCalls: 5 }]);
    fixture.detectChanges();
    expect(table!.textContent).toContain('5');
    expect(status.value).toBe('processing');
    const stream = element.querySelector<HTMLSelectElement>('#workspace-stream')!;
    stream.value = 's2';
    stream.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    pending.next([{ ...batch, name: 'Поздний ответ' }]);
    expect(element.textContent).not.toContain('Поздний ответ');
    expect(batches).toHaveBeenLastCalledWith({ organizationId: 'o1', streamId: 's2' });
    fixture.destroy();
    const count = batches.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(batches).toHaveBeenCalledTimes(count);
  });
});
