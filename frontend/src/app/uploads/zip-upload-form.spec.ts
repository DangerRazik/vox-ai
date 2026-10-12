import { TestBed } from '@angular/core/testing';
import { ZipUploadForm } from './zip-upload-form';
import { UploadFiles } from './upload-models';

async function render(initialStreamId = 'incoming') {
  await TestBed.configureTestingModule({ imports: [ZipUploadForm] }).compileComponents();
  const fixture = TestBed.createComponent(ZipUploadForm);
  fixture.componentRef.setInput('streams', [
    { id: 'incoming', organizationId: 'contact-center', name: 'Входящие' },
  ]);
  fixture.componentRef.setInput('initialStreamId', initialStreamId);
  const submissions: UploadFiles[] = [];
  fixture.componentInstance.submitted.subscribe((files) => submissions.push(files));
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const choose = async (id: string, file: File) => {
    const input = element.querySelector<HTMLInputElement>(id)!;
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

describe('Форма ZIP', () => {
  it('объясняет обязательные поля без отправки', async () => {
    const form = await render('');
    await form.submit();
    expect(form.element.querySelector('#stream-error')!.textContent).toContain('Выберите стрим');
    expect(form.element.querySelector('#archive-error')!.textContent).toContain(
      'Выберите ZIP-файл',
    );
    expect(form.submissions).toHaveLength(0);
  });
  it('показывает только ZIP и не передаёт метаданные', async () => {
    const form = await render();
    expect(form.element.querySelector('#upload-metadata')).toBeNull();
    const archive = new File(['test'], 'calls.ZIP');
    await form.choose('#upload-archive', archive);
    await form.submit();
    expect(form.submissions).toEqual([{ streamId: 'incoming', archive, metadata: null }]);
  });
  it('отклоняет другой тип файла и блокирует повторный submit при ожидании', async () => {
    const form = await render();
    await form.choose('#upload-archive', new File(['test'], 'calls.mp3'));
    await form.submit();
    expect(form.element.querySelector('#archive-error')!.textContent).toContain('.zip');
    await form.choose('#upload-archive', new File(['test'], 'calls.zip'));
    form.fixture.componentRef.setInput('locked', true);
    await form.fixture.whenStable();
    await form.submit();
    expect(form.submissions).toHaveLength(0);
    expect(form.element.querySelector('fieldset')!.disabled).toBe(true);
  });
});
