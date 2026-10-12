import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ConnectionPage } from './connection-page';

describe('Форма подключения к Vox AI', () => {
  it('отправляет введённый ключ только в заголовке и объясняет отказ без отражения секрета', async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ConnectionPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'connect', component: ConnectionPage }]),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConnectionPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#api-address')).toBeNull();
    const key = element.querySelector<HTMLInputElement>('#api-key')!;
    key.value = 'component-secret';
    key.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('/api/v1/access-context');
    expect(request.request.headers.get('Authorization')).toBe('Bearer component-secret');
    expect(request.request.url).not.toContain('component-secret');
    request.flush(
      { error: { message: 'component-secret' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')!.textContent).toContain('Ключ отклонён');
    expect(key.getAttribute('aria-invalid')).toBe('true');
    expect(key.getAttribute('aria-describedby')).toContain('key-error');
    expect(element.textContent).not.toContain('component-secret');
    expect(localStorage.length).toBe(0);
    expect(key.value).toBe('component-secret');
    http.verify();
  });
  it('не отправляет пустой или некорректный ключ; временный отказ сохраняет ввод для повтора', async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ConnectionPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConnectionPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const key = element.querySelector<HTMLInputElement>('#api-key')!;
    const form = element.querySelector('form')!;
    const http = TestBed.inject(HttpTestingController);
    key.value = '   ';
    key.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(element.querySelector('#key-error')!.textContent).toContain('Укажите API-ключ');
    expect(key.getAttribute('aria-invalid')).toBe('true');
    http.expectNone(() => true);
    key.value = 'invalid key';
    key.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(element.querySelector('#key-error')!.textContent).toContain('без пробелов внутри');
    http.expectNone(() => true);
    key.value = 'component-secret';
    key.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne('/api/v1/access-context').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')!.textContent).toContain('Повторите запрос');
    expect(key.value).toBe('component-secret');
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(localStorage.length).toBe(0);
    http.verify();
  });
});
