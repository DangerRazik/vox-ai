import { TestBed } from '@angular/core/testing';
import { BatchDetails } from '../batches/batch-details';
import { RecoveryForm } from './recovery-form';
import { UploadFiles } from './upload-models';

const details: BatchDetails = {
  batch: {
    id: 'batch-03',
    organizationId: 'contact-center',
    streamId: 'incoming',
    name: 'Батч 03.10',
    filename: 'calls-03.zip',
    createdAt: '2026-10-03T08:30:00Z',
    status: 'batch_failed',
    acceptedCalls: 120,
    averageTotal: null,
  },
  organization: { id: 'contact-center', name: 'Контакт-центр' },
  stream: { id: 'incoming', organizationId: 'contact-center', name: 'Входящие обращения' },
  uploadId: 'upload-batch-03',
  failure: 'Сбой сохранения',
  recovery: { expectedCalls: 120, receivedCalls: 0 },
};
async function render(context = details) {
  await TestBed.configureTestingModule({ imports: [RecoveryForm] }).compileComponents();
  const fixture = TestBed.createComponent(RecoveryForm);
  fixture.componentRef.setInput('details', context);
  const submissions: UploadFiles[] = [];
  fixture.componentInstance.submitted.subscribe((files) => submissions.push(files));
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const choose = async (file: File) => {
    const input = element.querySelector<HTMLInputElement>('#upload-archive')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
  };
  const submit = async () => {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };
  return { fixture, element, submissions, choose, submit };
}
describe('Форма повторной загрузки', () => {
  it('сохраняет исходный стрим и требует ZIP', async () => {
    const form = await render();
    expect(form.element.querySelector('#upload-stream')).toBeNull();
    await form.submit();
    expect(form.submissions).toHaveLength(0);
    expect(form.element.textContent).toContain('Выберите ZIP-файл');
  });
  it('показывает конфликт и сохраняет выбранный ZIP для исправления и следующей передачи', async () => {
    const form = await render();
    const archive = new File(['test'], 'repacked.zip');
    await form.choose(archive);
    await form.submit();
    form.fixture.componentRef.setInput('error', 'Переданы не все исходные записи');
    form.fixture.componentRef.setInput('details', {
      ...details,
      recovery: { expectedCalls: 120, receivedCalls: 119 },
    });
    await form.fixture.whenStable();
    expect(form.element.textContent).toContain('Переданы не все исходные записи');
    expect(form.element.querySelector<HTMLInputElement>('#upload-archive')!.files![0]).toBe(
      archive,
    );
    await form.submit();
    expect(form.submissions).toEqual([
      { streamId: 'incoming', archive, metadata: null },
      { streamId: 'incoming', archive, metadata: null },
    ]);
  });
  it('различает первичный импорт и восстановление закрытого состава', async () => {
    const form = await render({
      ...details,
      batch: { ...details.batch, status: 'upload_failed', acceptedCalls: 0 },
      recovery: null,
    });
    expect(form.element.textContent).toContain('Повтор первичного импорта');
    expect(form.element.textContent).toContain('Выберите исправленный ZIP');
    expect(form.element.textContent).not.toContain('Передайте весь исходный набор');
    expect(
      form.element.querySelector<HTMLButtonElement>('button[type=submit]')!.textContent,
    ).toContain('Повторить импорт');
  });
  it('во время передачи блокирует отправку без сброса файлов', async () => {
    const form = await render();
    const archive = new File(['test'], 'original.zip');
    await form.choose(archive);
    form.fixture.componentRef.setInput('locked', true);
    await form.fixture.whenStable();
    await form.submit();
    expect(form.submissions).toHaveLength(0);
    expect(form.element.querySelector('fieldset')!.disabled).toBe(true);
    expect(form.element.querySelector<HTMLInputElement>('#upload-archive')!.files![0]).toBe(
      archive,
    );
  });
});
