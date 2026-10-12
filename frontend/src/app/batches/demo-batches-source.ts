import { inject, Injectable } from '@angular/core';
import { defer, map, Observable, of, timer } from 'rxjs';
import { Batch, BatchQuery, DemoRole, DemoWorkspace, Stream } from './batch-models';
import { BatchesSource } from './batches-source';
import { DEMO_REPORTS, demoCompletedReport } from '../reports/demo-reports';
import { BatchReportData, BatchReportResult, CallReportResult } from '../reports/report-models';
import { demoCallAnalysis } from '../reports/demo-call-analysis';
import { BatchDetails, BatchDetailsResult, RecoveryProgress } from './batch-details';
import { ComparisonColumn, ComparisonResult } from '../comparison/comparison-models';
import { DemoOrganizations } from '../customers/demo-organizations';
import { DemoStreamCatalog } from '../streams/demo-stream-catalog';

interface DemoBatchMetadata {
  uploadId: string;
  uploadErrors?: number;
  failure?: string | null;
  recovery?: RecoveryProgress | null;
}

const BATCHES: readonly Batch[] = [
  {
    id: 'support-05',
    organizationId: 'support',
    streamId: 'support-incoming',
    name: 'Поддержка 05.10',
    filename: 'support-05.zip',
    createdAt: '2026-10-05T08:00:00Z',
    status: 'ready',
    acceptedCalls: 3,
    averageTotal: null,
  },
  {
    id: 'batch-01',
    organizationId: 'contact-center',
    streamId: 'incoming',
    name: 'Батч 01.10',
    filename: 'calls-01.zip',
    createdAt: '2026-10-01T07:00:00Z',
    status: 'completed',
    acceptedCalls: 2,
    averageTotal: DEMO_REPORTS['batch-01'].summary.averageTotal,
  },
  {
    id: 'batch-06',
    organizationId: 'contact-center',
    streamId: 'incoming',
    name: 'Батч 06.10',
    filename: 'morning.zip',
    createdAt: '2026-10-06T06:00:00Z',
    status: 'processing',
    acceptedCalls: 300,
    averageTotal: null,
  },
  {
    id: 'batch-05',
    organizationId: 'contact-center',
    streamId: 'incoming',
    name: 'Батч 05.10',
    filename: 'calls-05.zip',
    createdAt: '2026-10-05T07:20:00Z',
    status: 'ready',
    acceptedCalls: 90,
    averageTotal: null,
  },
  {
    id: 'batch-04',
    organizationId: 'contact-center',
    streamId: 'incoming',
    name: 'Батч 04.10',
    filename: 'calls-04.zip',
    createdAt: '2026-10-04T07:15:00Z',
    status: 'completed',
    acceptedCalls: 90,
    averageTotal: DEMO_REPORTS['batch-04'].summary.averageTotal,
  },
  {
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
  {
    id: 'batch-02',
    organizationId: 'contact-center',
    streamId: 'incoming',
    name: 'Батч 02.10',
    filename: 'calls-02.zip',
    createdAt: '2026-10-02T06:00:00Z',
    status: 'completed',
    acceptedCalls: 12,
    averageTotal: null,
  },
  {
    id: 'outgoing-06',
    organizationId: 'contact-center',
    streamId: 'outgoing',
    name: 'Исходящие 06.10',
    filename: 'outgoing.zip',
    createdAt: '2026-10-06T09:00:00Z',
    status: 'queued',
    acceptedCalls: 45,
    averageTotal: null,
  },
  {
    id: 'outgoing-05',
    organizationId: 'contact-center',
    streamId: 'outgoing',
    name: 'Исходящие 05.10',
    filename: 'damaged.zip',
    createdAt: '2026-10-05T10:00:00Z',
    status: 'upload_failed',
    acceptedCalls: 0,
    averageTotal: null,
  },
  {
    id: 'outgoing-04',
    organizationId: 'contact-center',
    streamId: 'outgoing',
    name: 'Исходящие 04.10',
    filename: 'upload.zip',
    createdAt: '2026-10-04T11:00:00Z',
    status: 'uploading',
    acceptedCalls: 17,
    averageTotal: null,
  },
  {
    id: 'support-06',
    organizationId: 'support',
    streamId: 'support-incoming',
    name: 'Поддержка 06.10',
    filename: 'support.zip',
    createdAt: '2026-10-06T08:00:00Z',
    status: 'completed',
    acceptedCalls: 30,
    averageTotal: DEMO_REPORTS['support-06'].summary.averageTotal,
  },
];

@Injectable({ providedIn: 'root' })
export class DemoBatchesSource extends BatchesSource {
  private readonly organizations = inject(DemoOrganizations);
  private readonly streamCatalog = inject(DemoStreamCatalog);
  private failNextComparison = false;
  simulateNextComparisonError(): void {
    this.failNextComparison = true;
  }
  override compareBatches(
    role: DemoRole,
    query: BatchQuery,
    batchIds: readonly string[],
  ): Observable<ComparisonResult> {
    return defer(() => {
      const fail = this.failNextComparison;
      this.failNextComparison = false;
      return timer(350).pipe(
        map(() => {
          if (fail) throw new Error('Демонстрационная ошибка чтения сравнения');
          const ids = [...new Set(batchIds)];
          if (ids.length < 2)
            return {
              kind: 'invalid-selection',
              message: 'Выберите хотя бы два завершённых батча.',
            } as const;
          const stream = this.streamCatalog
            .all()
            .find(
              (item) => item.id === query.streamId && item.organizationId === query.organizationId,
            );
          if (!stream)
            return {
              kind: 'invalid-selection',
              message: 'Стрим недоступен для сравнения.',
            } as const;
          const columns: ComparisonColumn[] = [];
          for (const id of ids) {
            const batch = this.accessibleBatch(role, id);
            if (
              !batch ||
              batch.organizationId !== query.organizationId ||
              batch.streamId !== stream.id ||
              batch.status !== 'completed' ||
              !this.reportData(id)
            ) {
              return {
                kind: 'invalid-selection',
                message:
                  'Выбранные батчи должны быть завершены и принадлежать одному доступному стриму.',
              } as const;
            }
            columns.push({ batch, summary: this.reportData(id)!.summary });
          }
          return { kind: 'available', stream, columns } as const;
        }),
      );
    });
  }
  private readonly uploadedBatches = new Map<string, Batch>();
  private readonly metadata = new Map<string, DemoBatchMetadata>();
  private readonly completedReports = new Map<string, BatchReportData>();
  private reportData(batchId: string): BatchReportData | undefined {
    return this.completedReports.get(batchId) ?? DEMO_REPORTS[batchId];
  }
  completeDemoBatch(batchId: string): void {
    const details = this.currentDetails('team', batchId);
    if (!details || details.batch.status !== 'processing')
      throw new Error('Батч не обрабатывается');
    const stream = this.streamCatalog.all().find((s) => s.id === details.stream.id)!;
    const report = demoCompletedReport(
      batchId,
      details.batch.acceptedCalls,
      this.metadata.get(batchId)?.uploadErrors ?? 0,
      stream.criteria.map((c) => c.id),
      stream.options.zeroTotalOnCritical,
    );
    this.completedReports.set(batchId, report);
    this.registerUploadedBatch({
      ...details.batch,
      status: 'completed',
      averageTotal: report.summary.averageTotal,
      maxTotal: report.summary.maxTotal,
    });
  }
  private readonly activeImports = new Map<string, number>();
  beginImport(streamId: string): () => void {
    this.activeImports.set(streamId, (this.activeImports.get(streamId) ?? 0) + 1);
    return () => {
      const remaining = (this.activeImports.get(streamId) ?? 1) - 1;
      if (remaining) this.activeImports.set(streamId, remaining);
      else this.activeImports.delete(streamId);
    };
  }
  private failNextDetailsRequest = false;
  registerUploadedBatch(batch: Batch, metadata?: DemoBatchMetadata): void {
    this.uploadedBatches.set(batch.id, batch);
    if (metadata) this.metadata.set(batch.id, { ...this.metadata.get(batch.id), ...metadata });
  }
  private allBatches(): readonly Batch[] {
    const streams = new Set(this.streamCatalog.all().map((stream) => stream.id));
    return [
      ...this.uploadedBatches.values(),
      ...BATCHES.filter((batch) => !this.uploadedBatches.has(batch.id)),
    ]
      .filter((batch) => streams.has(batch.streamId))
      .map((batch) => ({
        ...batch,
        maxTotal: this.streamCatalog.all().find((s) => s.id === batch.streamId)!.criteria.length,
      }));
  }
  hasActiveWork(streamId: string): boolean {
    return (
      this.activeImports.has(streamId) ||
      this.allBatches().some(
        (batch) =>
          batch.streamId === streamId &&
          (batch.status === 'uploading' || batch.status === 'processing'),
      )
    );
  }
  removeStreamData(streamId: string): void {
    for (const [id, batch] of this.uploadedBatches) {
      if (batch.streamId === streamId) {
        this.uploadedBatches.delete(id);
        this.metadata.delete(id);
        this.completedReports.delete(id);
      }
    }
  }
  private accessibleBatch(role: DemoRole, batchId: string): Batch | undefined {
    return this.allBatches().find(
      (item) =>
        item.id === batchId &&
        (role === 'team' || item.organizationId === this.organizations.all()[0]!.id),
    );
  }
  simulateNextDetailsError(): void {
    this.failNextDetailsRequest = true;
  }
  override batchDetails(role: DemoRole, batchId: string): Observable<BatchDetailsResult> {
    return defer(() => {
      const fail = this.failNextDetailsRequest;
      this.failNextDetailsRequest = false;
      return timer(350).pipe(
        map(() => {
          if (fail) throw new Error('Демонстрационная ошибка чтения состояния');
          const details = this.currentDetails(role, batchId);
          return details
            ? ({ kind: 'available', details } as const)
            : ({ kind: 'not-found' } as const);
        }),
      );
    });
  }
  currentDetails(role: DemoRole, batchId: string): BatchDetails | null {
    const batch = this.accessibleBatch(role, batchId);
    if (!batch) return null;
    const metadata = this.metadata.get(batch.id);
    return {
      batch,
      organization: this.organizations.all().find((item) => item.id === batch.organizationId)!,
      stream: this.streamCatalog.all().find((item) => item.id === batch.streamId)!,
      uploadId: metadata?.uploadId ?? `upload-${batch.id}`,
      failure:
        metadata?.failure !== undefined
          ? metadata.failure
          : batch.status === 'upload_failed'
            ? 'Не удалось распаковать ZIP. Ни одной записи не принято.'
            : batch.status === 'batch_failed'
              ? 'Сбой сохранения результатов всего батча. Отчёт не опубликован.'
              : null,
      recovery:
        metadata?.recovery ??
        (batch.status === 'batch_failed'
          ? { expectedCalls: batch.acceptedCalls, receivedCalls: 0 }
          : null),
    };
  }
  private failNextRequest = false;
  private failNextReportRequest = false;
  private failNextCallRequest = false;

  simulateNextCallError(): void {
    this.failNextCallRequest = true;
  }

  override callReport(
    role: DemoRole,
    batchId: string,
    callId: string,
  ): Observable<CallReportResult> {
    return defer(() => {
      const fail = this.failNextCallRequest;
      this.failNextCallRequest = false;
      return timer(350).pipe(
        map((): CallReportResult => {
          if (fail) throw new Error('Демонстрационная ошибка чтения звонка');
          const context = this.reportContext(role, batchId);
          if (context.kind !== 'available') return context;
          const { batch, organization, stream } = context;
          const call = this.reportData(batch.id)?.calls.find((item) => item.id === callId);
          if (!call) return { kind: 'not-found' };
          return {
            kind: 'available',
            report: {
              batch,
              organization,
              stream,
              call,
              analysis: demoCallAnalysis(call, stream.options),
            },
          };
        }),
      );
    });
  }

  simulateNextReportError(): void {
    this.failNextReportRequest = true;
  }

  override batchReport(role: DemoRole, batchId: string): Observable<BatchReportResult> {
    return defer(() => {
      const fail = this.failNextReportRequest;
      this.failNextReportRequest = false;
      return timer(350).pipe(
        map((): BatchReportResult => {
          if (fail) throw new Error('Демонстрационная ошибка чтения отчёта');
          const context = this.reportContext(role, batchId);
          if (context.kind !== 'available') return context;
          const { batch, organization, stream } = context;
          const data = this.reportData(batch.id);
          if (!data) return { kind: 'not-found' };
          return { kind: 'available', report: { ...data, batch, organization, stream } };
        }),
      );
    });
  }

  private reportContext(role: DemoRole, batchId: string) {
    const batch = this.accessibleBatch(role, batchId);
    if (!batch) return { kind: 'not-found' } as const;
    const organization = this.organizations.all().find((item) => item.id === batch.organizationId)!;
    if (batch.status !== 'completed') return { kind: 'unavailable', batch, organization } as const;
    const stream = this.streamCatalog.all().find((item) => item.id === batch.streamId)!;
    return { kind: 'available', batch, organization, stream } as const;
  }

  simulateNextListError(): void {
    this.failNextRequest = true;
  }
  override workspace(role: DemoRole): Observable<DemoWorkspace> {
    return of({
      role,
      organizations:
        role === 'customer' ? this.organizations.all().slice(0, 1) : this.organizations.all(),
    });
  }

  override streams(organizationId: string): Observable<readonly Stream[]> {
    return of(
      this.streamCatalog.all().filter((stream) => stream.organizationId === organizationId),
    );
  }

  override batches(query: BatchQuery): Observable<readonly Batch[]> {
    return defer(() => {
      const fail = this.failNextRequest;
      this.failNextRequest = false;
      return timer(350).pipe(
        map(() => {
          if (fail) throw new Error('Демонстрационная ошибка чтения списка');
          return this.allBatches().filter(
            (batch) =>
              batch.organizationId === query.organizationId && batch.streamId === query.streamId,
          );
        }),
      );
    });
  }
}
