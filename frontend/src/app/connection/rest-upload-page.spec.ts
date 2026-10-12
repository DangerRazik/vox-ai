import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ApiConnection, connectedOnly } from './api-connection';
import { RestUploadPage } from './rest-upload-page';
import { afterEach, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('ошибка ZIP от REST связана с полем; повтор сохраняет идентификатор', async () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  localStorage.clear();
  const oldUploadId = '11111111-1111-4111-8111-111111111111';
  localStorage.setItem(
    'vox-upload-draft:' + JSON.stringify(['/api/v1', 'o1']),
    JSON.stringify({ uploadId: oldUploadId, streamId: 'old-stream' }),
  );
  await TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        {
          path: 'customer/upload',
          component: RestUploadPage,
          data: { role: 'customer' },
          canActivate: [connectedOnly],
        },
      ]),
    ],
  }).compileComponents();
  const http = TestBed.inject(HttpTestingController);
  const login = TestBed.inject(ApiConnection).connect('controlled-key');
  http
    .expectOne('/api/v1/access-context')
    .flush({ role: 'customer', customer: { customer_id: 'o1', name: 'Заказчик' } });
  await login;
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/customer/upload');
  http
    .expectOne((r) => r.url === '/api/v1/streams')
    .flush({
      items: [
        {
          stream_id: 's1',
          customer_id: 'o1',
          name: 'Стрим',
          created_at: '2026-10-01T00:00:00Z',
          options: {},
          criteria: [],
        },
      ],
    });
  await harness.fixture.whenStable();
  const element = harness.routeNativeElement!;
  expect(element.querySelector('[data-testid=upload-id]')!.textContent).not.toBe(oldUploadId);
  expect(element.querySelector<HTMLSelectElement>('#upload-stream')!.value).toBe('s1');
  expect(element.textContent).not.toContain('Начать новую загрузку');
  expect(element.textContent).not.toContain('Загрузить ещё ZIP');
  const archive = new File(['audio'], 'calls.zip');
  const choose = async (id: string, file: File) => {
    const input = element.querySelector<HTMLInputElement>(id)!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await harness.fixture.whenStable();
  };
  await choose('#upload-archive', archive);
  element
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await harness.fixture.whenStable();
  const first = http.expectOne('/api/v1/batch-archives');
  const body = first.request.body as FormData;
  const id = body.get('upload_id');
  expect(body.get('stream_id')).toBe('s1');
  expect(body.get('archive')).toBeInstanceOf(File);
  expect(body.has('metadata_file')).toBe(false);
  expect(first.request.headers.has('Content-Type')).toBe(false);
  first.flush(
    { error: { code: 'encrypted_archive', message: 'invalid' } },
    { status: 422, statusText: 'Unprocessable Entity' },
  );
  await harness.fixture.whenStable();
  expect(element.querySelector('#upload-archive')!.getAttribute('aria-invalid')).toBe('true');
  expect(element.querySelector('#archive-error')!.textContent).toContain('Нужен ZIP без пароля');
  expect(element.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(false);
  await choose('#upload-archive', archive);
  await harness.fixture.whenStable();
  element
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await harness.fixture.whenStable();
  const second = http.expectOne('/api/v1/batch-archives');
  expect((second.request.body as FormData).get('upload_id')).toBe(id);
  expect((second.request.body as FormData).get('archive')).toBeInstanceOf(File);
  expect((second.request.body as FormData).has('metadata_file')).toBe(false);
  second.flush({
    batch_id: 'b1',
    customer_id: 'o1',
    stream_id: 's1',
    upload_id: id,
    created_at: '2026-10-01T00:00:00Z',
    status: 'ready',
    total_calls: 1,
    items: [{ status: 'accepted', original_name: 'call.wav' }],
  });
  await harness.fixture.whenStable();
  expect(element.textContent).toContain('Ожидает ручного запуска');
  const anotherUpload = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Загрузить ещё ZIP',
  );
  expect(anotherUpload).toBeDefined();
  anotherUpload!.click();
  await harness.fixture.whenStable();
  expect(element.querySelector('[data-testid=upload-id]')!.textContent).not.toBe(id);
  expect(element.querySelector<HTMLInputElement>('#upload-archive')!.files!.length).toBe(0);
  expect(element.querySelector<HTMLSelectElement>('#upload-stream')!.value).toBe('s1');
  expect(element.textContent).not.toContain('Загрузить ещё ZIP');
  expect(element.textContent).not.toContain('Начать новую загрузку');
  expect(element.textContent).not.toContain('Ожидает ручного запуска');
  http.verify();
});
