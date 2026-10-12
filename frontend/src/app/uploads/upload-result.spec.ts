import { TestBed } from '@angular/core/testing';
import { UploadIntakeResult } from './upload-result';
import { UploadResult } from './upload-models';

const partial: UploadResult = {
  uploadId: 'upload-1',
  batch: {
    id: 'batch-1',
    organizationId: 'contact-center',
    streamId: 'incoming',
    name: 'calls.zip',
    filename: 'calls.zip',
    createdAt: '2026-10-06T09:00:00Z',
    status: 'ready',
    acceptedCalls: 2,
    averageTotal: null,
  },
  accepted: ['calls/001.wav', 'calls/002.wav'],
  duplicates: [{ filename: 'calls/copy.wav', original: 'calls/001.wav' }],
  errors: [{ filename: 'calls/broken.wav', reason: 'Не удалось прочитать аудио' }],
};
async function render(result: UploadResult) {
  await TestBed.configureTestingModule({ imports: [UploadIntakeResult] }).compileComponents();
  const fixture = TestBed.createComponent(UploadIntakeResult);
  fixture.componentRef.setInput('result', result);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}
describe('Результаты приёма ZIP', () => {
  it('разделяет принятые записи, дубликаты и ошибки без отмены частичного приёма', async () => {
    const element = await render(partial);
    expect(element.textContent).toContain('Принято уникальных записей: 2');
    expect(element.textContent).toContain('Дубликаты: 1');
    expect(element.textContent).toContain('Ошибки файлов: 1');
    expect(element.textContent).toContain('calls/copy.wav — Дубликат calls/001.wav');
    expect(element.textContent).toContain('calls/broken.wav — Ошибка: Не удалось прочитать аудио');
    expect(element.textContent).toContain('Ожидает ручного запуска командой Vox AI');
  });
  it('при нуле принятых объясняет невозможность запуска', async () => {
    const element = await render({
      ...partial,
      batch: { ...partial.batch, status: 'upload_failed', acceptedCalls: 0 },
      accepted: [],
      duplicates: [],
    });
    expect(element.textContent).toContain('Принято уникальных записей: 0');
    expect(element.textContent).toContain('ZIP не принят');
    expect(element.textContent).not.toContain('Ожидает ручного запуска');
  });
  it('неудачный REST-приём показывает одну ошибку и повтор в прежний батч', async () => {
    const element = await render({
      ...partial,
      batch: { ...partial.batch, status: 'upload_failed', acceptedCalls: 0 },
      accepted: [],
      duplicates: [],
      errors: [{ filename: 'nested.zip', reason: 'Файл не удалось прочитать как аудио.' }],
    });
    expect(element.querySelectorAll('[role=alert]').length).toBe(1);
    expect(element.textContent).toContain('ZIP не принят');
    expect(element.textContent).toContain('Идентификатор и стрим сохранены');
    expect(element.textContent).toContain(
      'nested.zip — Ошибка: Файл не удалось прочитать как аудио.',
    );
    expect(element.textContent).not.toContain('Частичные ошибки');
    expect(element.textContent).not.toContain('Дубликаты не входят');
    expect(element.textContent).not.toContain('Ожидает ручного запуска');
  });
  it('частичный REST-приём сохраняет успешные файлы и ожидание запуска', async () => {
    const element = await render(partial);
    expect(element.textContent).toContain('Принято уникальных записей: 2');
    expect(element.textContent).toContain('Частичные ошибки не отменяют');
    expect(element.textContent).toContain('Ожидает ручного запуска');
    expect(element.textContent).not.toContain('ZIP не принят');
  });
});

it('компактный результат показывает счётчики и причину без отдельной карточки и повторной инструкции', async () => {
  await TestBed.configureTestingModule({ imports: [UploadIntakeResult] }).compileComponents();
  const fixture = TestBed.createComponent(UploadIntakeResult);
  fixture.componentRef.setInput('result', {
    ...partial,
    batch: { ...partial.batch, status: 'upload_failed', acceptedCalls: 0 },
    accepted: [],
  });
  fixture.componentRef.setInput('compact', true);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.textContent).toContain('Ошибки файлов: 1');
  expect(element.textContent).toContain('Не удалось прочитать аудио');
  expect(element.querySelector('.upload-result')).toBeNull();
  expect(element.querySelector('h2')).toBeNull();
  expect(element.textContent).not.toContain('ZIP не принят');
});
