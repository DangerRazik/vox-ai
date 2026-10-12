import { TestBed } from '@angular/core/testing';
import { DeleteStreamConfirmation } from './delete-stream-confirmation';

// jsdom не реализует модальные API. Подменяется только браузерная граница;
// реальный фокус, фон и Escape дополнительно проверяются в Playwright.
const dialogApis = ['showModal', 'close'] as const;
const originalApis = dialogApis.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);
beforeEach(() => {
  for (const name of dialogApis)
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = name === 'showModal';
      },
    });
});
afterEach(() => {
  dialogApis.forEach((name, index) => {
    const original = originalApis[index];
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

async function render() {
  await TestBed.configureTestingModule({ imports: [DeleteStreamConfirmation] }).compileComponents();
  const fixture = TestBed.createComponent(DeleteStreamConfirmation);
  fixture.componentRef.setInput('stream', {
    id: 'stream-1',
    organizationId: 'org-1',
    name: 'Правила поддержки',
  });
  const events: string[] = [];
  fixture.componentInstance.confirmed.subscribe(() => events.push('confirmed'));
  fixture.componentInstance.cancelled.subscribe(() => events.push('cancelled'));
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const dialog = element.querySelector('dialog')!;
  const buttons = element.querySelectorAll('button');
  return { fixture, element, dialog, events, cancel: buttons[0], confirm: buttons[1] };
}

describe('Подтверждение удаления стрима', () => {
  it('показывает имя, ID и последствия, ждёт действия; Escape означает отмену', async () => {
    const view = await render();
    expect(view.element.textContent).toContain('Правила поддержки');
    expect(view.element.textContent).toContain('stream-1');
    expect(view.element.textContent).toContain('батчи, транскрипции и вся история результатов');
    expect(view.events).toEqual([]);
    expect(view.dialog.open).toBe(true);
    view.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(view.events).toEqual(['cancelled']);
    expect(view.dialog.open).toBe(false);
  });
  it('при ошибке сохраняет подтверждение, отправляет решение только по нажатию', async () => {
    const view = await render();
    view.fixture.componentRef.setInput('requestError', 'Сбой удаления');
    await view.fixture.whenStable();
    expect(view.element.querySelector('[role="alert"]')?.textContent).toBe('Сбой удаления');
    expect(view.events).toEqual([]);
    view.confirm.click();
    expect(view.events).toEqual(['confirmed']);
  });
  it('при запросе блокирует повтор и отмену, после ответа снова разрешает отмену', async () => {
    const view = await render();
    view.fixture.componentRef.setInput('locked', true);
    await view.fixture.whenStable();
    expect(view.confirm.disabled).toBe(true);
    expect(view.cancel.disabled).toBe(true);
    view.confirm.click();
    view.cancel.click();
    view.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(view.events).toEqual([]);
    view.fixture.componentRef.setInput('locked', false);
    await view.fixture.whenStable();
    view.cancel.click();
    expect(view.events).toEqual(['cancelled']);
  });
});
