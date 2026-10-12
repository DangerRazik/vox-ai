import { TestBed } from '@angular/core/testing';
import { CustomerForm } from './customer-form';

async function render() {
  await TestBed.configureTestingModule({ imports: [CustomerForm] }).compileComponents();
  const fixture = TestBed.createComponent(CustomerForm);
  const submitted: string[] = [];
  fixture.componentInstance.submitted.subscribe((name) => submitted.push(name));
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const input = element.querySelector<HTMLInputElement>('input')!;
  const fill = async (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const submit = async () => {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };
  return { fixture, element, input, submitted, fill, submit };
}
describe('Форма создания заказчика', () => {
  for (const value of ['', '   ']) {
    it(`не принимает ${value ? 'только пробелы' : 'пустое имя'} и поясняет ошибку`, async () => {
      const form = await render();
      await form.fill(value);
      await form.submit();
      expect(form.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Укажите название заказчика',
      );
      expect(form.input.getAttribute('aria-invalid')).toBe('true');
      expect(form.submitted).toEqual([]);
    });
  }
  it('исправляет ошибку и отправляет имя без краевых пробелов, сохраняя введённый текст', async () => {
    const form = await render();
    await form.submit();
    await form.fill('  Новый заказчик  ');
    await form.submit();
    expect(form.submitted).toEqual(['Новый заказчик']);
    expect(form.input.value).toBe('  Новый заказчик  ');
    expect(form.element.querySelector('[role="alert"]')).toBeNull();
  });
  it('сохраняет имя при ошибке запроса и позволяет повторить создание', async () => {
    const form = await render();
    await form.fill('Сервис');
    form.fixture.componentRef.setInput('requestError', 'Не удалось создать заказчика');
    await form.fixture.whenStable();
    expect(form.input.value).toBe('Сервис');
    expect(form.element.querySelector('button')?.textContent?.trim()).toBe('Повторить создание');
    await form.submit();
    expect(form.submitted).toEqual(['Сервис']);
  });
  it('блокирует повторную отправку во время создания, не стирая имя', async () => {
    const form = await render();
    await form.fill('Сервис');
    form.fixture.componentRef.setInput('locked', true);
    await form.fixture.whenStable();
    await form.submit();
    expect(form.element.querySelector('button')?.disabled).toBe(true);
    expect(form.input.disabled).toBe(true);
    expect(form.input.value).toBe('Сервис');
    expect(form.submitted).toEqual([]);
  });
});

it('длинное название отклоняется рядом с полем и сохраняется для исправления', async () => {
  const form = await render();
  await form.fill('я'.repeat(201));
  await form.submit();
  expect(form.submitted).toEqual([]);
  expect(form.input.value).toHaveLength(201);
  expect(form.input.getAttribute('aria-invalid')).toBe('true');
  expect(form.element.querySelector('#customer-name-error')?.textContent).toContain('200');
  await form.fill('Исправленное имя');
  await form.submit();
  expect(form.submitted).toEqual(['Исправленное имя']);
});
