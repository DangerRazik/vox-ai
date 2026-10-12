import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ApiConnection, connectedOnly } from './api-connection';
import { RestReportsSource } from './rest-reports-source';
import { ReportsSource } from '../reports/reports-source';
import { BatchReportPage } from '../reports/batch-report-page';
import { CallReportPage } from '../reports/call-report-page';
import { CRITERIA } from '../reports/report-models';

const batch = {
  batch_id: 'b1',
  customer_id: 'o1',
  stream_id: 's1',
  upload_id: 'u1',
  created_at: '2026-10-01T00:00:00Z',
  status: 'completed',
  total_calls: 1,
};
const stream = {
  stream_id: 's1',
  customer_id: 'o1',
  name: 'Поддержка',
  options: { speech_rate_enabled: true, zero_total_on_critical: true },
};
async function setup() {
  localStorage.clear();
  await TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ReportsSource, useExisting: RestReportsSource },
      provideRouter([
        {
          path: 'customer/batches/:batchId/report',
          component: BatchReportPage,
          data: { role: 'customer', mode: 'rest' },
          canActivate: [connectedOnly],
        },
        {
          path: 'customer/batches/:batchId/calls/:callId',
          component: CallReportPage,
          data: { role: 'customer', mode: 'rest' },
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
  return { http, harness: await RouterTestingHarness.create() };
}
function context(http: HttpTestingController, status = 'completed') {
  http.expectOne('/api/v1/batches/b1').flush({ ...batch, status });
  http.expectOne('/api/v1/streams/s1').flush(stream);
}

describe('Рабочие компоненты отчётов через REST', () => {
  it('показывает null как отсутствие данных, а ошибку звонка без придуманного этапа', async () => {
    const { http, harness } = await setup();
    await harness.navigateByUrl('/customer/batches/b1/report');
    context(http);
    http
      .expectOne('/api/v1/batches/b1/report')
      .flush({
        batch_id: 'b1',
        stream_id: 's1',
        total_calls: 1,
        successful_calls: 0,
        processing_errors: 1,
        upload_errors: 2,
        average_total: null,
        criterion_averages: Object.fromEntries(CRITERIA.map((c) => [c.id, null])),
        critical_violation_count: 0,
        critical_violation_rate: null,
      });
    http.expectOne('/api/v1/batches/b1/calls').flush({ items: [{ call_id: 'c1' }] });
    http
      .expectOne('/api/v1/calls/c1/report')
      .flush({
        call_id: 'c1',
        batch_id: 'b1',
        stream_id: 's1',
        original_name: 'звонок.mp3',
        external_employee_id: null,
        called_at: null,
        status: 'processing_error',
        result: null,
        error: 'call_processing_failed',
      });
    await harness.fixture.whenStable();
    const element = harness.routeNativeElement!;
    expect(element.querySelector('[aria-labelledby="average-title"]')!.textContent).toContain(
      'Нет данных',
    );
    expect(element.textContent).toContain('Ошибка обработки записи');
    expect(element.textContent).not.toContain('Ошибка транскрибации');
    expect(element.querySelector('a[href="/customer/batches/b1/calls/c1"]')!.textContent).toBe(
      'звонок.mp3',
    );
    expect(element.textContent).not.toContain('Демо · условные данные');
    http.verify();
  });
  it('сохраняет серверный нулевой итог, каноническое нарушение и исходную оценку', async () => {
    const { http, harness } = await setup();
    await harness.navigateByUrl('/customer/batches/b1/calls/c1');
    context(http);
    http
      .expectOne('/api/v1/calls/c1/report')
      .flush({
        call_id: 'c1',
        batch_id: 'b1',
        stream_id: 's1',
        original_name: 'звонок.mp3',
        external_employee_id: null,
        called_at: null,
        status: 'successful',
        error: null,
        result: {
          total: 0,
          critical_violation: true,
          critical_violation_details: 'Грубое обращение',
          scores: Object.fromEntries(
            CRITERIA.map((c) => [
              c.id,
              { score: c.id === '5.2' ? 0 : 1, reason: 'Пояснение сервера' },
            ]),
          ),
        },
      });
    await harness.fixture.whenStable();
    const element = harness.routeNativeElement!;
    expect(element.querySelector('[aria-label="Итоговая оценка"]')!.textContent).toMatch(
      /0\s+из 11/,
    );
    expect(element.querySelector('[aria-label="Критическое нарушение"]')!.textContent).toContain(
      'Итог обнулён',
    );
    expect(element.querySelectorAll('details')).toHaveLength(11);
    expect(element.querySelector('details[aria-label="Приветствие"]')!.textContent).toContain(
      '1 из 1',
    );
    expect(element.textContent).toContain('Транскрипция отсутствует');
    http.verify();
  });
  it('объясняет отказ публикации 409 без средних и таблицы звонков', async () => {
    const { http, harness } = await setup();
    await harness.navigateByUrl('/customer/batches/b1/report');
    context(http);
    http
      .expectOne('/api/v1/batches/b1/report')
      .flush({ error: { code: 'report_not_available' } }, { status: 409, statusText: 'Conflict' });
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement!.textContent).toContain('Отчёт ещё недоступен');
    expect(harness.routeNativeElement!.querySelector('app-report-summary')).toBeNull();
    http.verify({ ignoreCancelled: true });
  });
});
