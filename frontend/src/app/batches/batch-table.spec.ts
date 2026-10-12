import { TestBed } from '@angular/core/testing';
import { Batch } from './batch-models';
import { BatchTable } from './batch-table';
import { provideRouter } from '@angular/router';
import { batchFromRest } from '../connection/rest-report-models';

const sample: Batch = {
  id: 'test-call-group',
  organizationId: 'customer',
  streamId: 'stream',
  name: 'Проверяемая загрузка',
  filename: 'calls.zip',
  createdAt: '2026-10-06T22:30:00Z',
  status: 'completed',
  acceptedCalls: 10,
  averageTotal: 0,
};

async function table(batch: Batch): Promise<HTMLElement> {
  await TestBed.configureTestingModule({
    imports: [BatchTable],
    providers: [provideRouter([])],
  }).compileComponents();
  const fixture = TestBed.createComponent(BatchTable);
  fixture.componentRef.setInput('batches', [batch]);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Отображение итогов батча', () => {
  it('показывает полный UUID в названии, ссылке и подсказке', async () => {
    const id = 'c12c9b8b-80b8-4705-a00d-8d295ce182eb';
    const uploadId = '144dfcb3-ad4f-47cf-aa7f-44907471fa7d';
    const element = await table(
      batchFromRest(
        {
          batch_id: id,
          customer_id: 'customer',
          stream_id: 'stream',
          upload_id: uploadId,
          created_at: sample.createdAt,
          status: 'completed',
          total_calls: 4,
        },
        5.88,
      ),
    );
    expect(element.textContent).toContain(`Загрузка ${uploadId}`);
    expect(element.querySelector('.batch-name')?.getAttribute('title')).toBe(uploadId);
    expect(element.querySelector('a')?.getAttribute('href')).toBe(`/${id}/report`);
  });
  it('отличает опубликованный нулевой итог от отсутствия данных', async () => {
    const element = await table(sample);
    expect(element.textContent).toContain('0 из 11');
    expect(element.textContent).not.toContain('Нет данных');
  });

  it('показывает отсутствие данных у завершённого батча без успешных результатов', async () => {
    const element = await table({ ...sample, averageTotal: null });
    expect(element.textContent).toContain('Нет данных');
    expect(element.textContent).not.toContain('0 из 11');
  });

  it('не публикует случайно переданную среднюю оценку незавершённого батча', async () => {
    const element = await table({ ...sample, status: 'processing', averageTotal: 9.65 });
    expect(element.textContent).toContain('Ещё не опубликован');
    expect(element.textContent).not.toContain('9,65');
  });

  it('отображает дату в московском часовом поясе независимо от компьютера', async () => {
    const element = await table(sample);
    expect(element.querySelector('time')?.textContent).toBe('07.10.2026');
  });
});
