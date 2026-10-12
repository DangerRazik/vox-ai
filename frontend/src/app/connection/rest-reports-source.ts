import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  forkJoin,
  from,
  map,
  mergeMap,
  of,
  switchMap,
  throwError,
  toArray,
} from 'rxjs';
import { ApiConnection } from './api-connection';
import { ReportsSource } from '../reports/reports-source';
import { Batch, BatchQuery, AccessRole, Organization } from '../batches/batch-models';
import { BatchReportResult, CallReportResult } from '../reports/report-models';
import { ComparisonResult } from '../comparison/comparison-models';
import {
  BatchDto,
  StreamDto,
  SummaryDto,
  CallDto,
  batchFromRest,
  summaryFromRest,
  callFromRest,
  analysisFromRest,
} from './rest-report-models';

@Injectable({ providedIn: 'root' })
export class RestReportsSource extends ReportsSource {
  private readonly connection = inject(ApiConnection);
  private context(batchId: string) {
    return this.connection.get<BatchDto>(`/batches/${encodeURIComponent(batchId)}`).pipe(
      switchMap((batch) =>
        forkJoin({
          stream: this.connection.get<StreamDto>(`/streams/${encodeURIComponent(batch.stream_id)}`),
          organization: this.connection.access()!.organization
            ? of(this.connection.access()!.organization!)
            : this.connection
                .get<{ customer_id: string; name: string }>(
                  `/customers/${encodeURIComponent(batch.customer_id)}`,
                )
                .pipe(map((owner) => ({ id: owner.customer_id, name: owner.name }))),
        }).pipe(
          map((context) => ({
            ...context,
            stream: {
              ...context.stream,
              id: context.stream.stream_id,
              organizationId: context.stream.customer_id,
            },
            batch: batchFromRest(batch),
          })),
        ),
      ),
    );
  }
  batchReport(_role: AccessRole, batchId: string): Observable<BatchReportResult> {
    return this.context(batchId).pipe(
      switchMap((context) => {
        if (context.batch.status !== 'completed')
          return of<BatchReportResult>({ kind: 'unavailable', ...context });
        return forkJoin({
          summary: this.connection.get<SummaryDto>(
            `/batches/${encodeURIComponent(batchId)}/report`,
          ),
          calls: this.connection
            .get<{ items: { call_id: string }[] }>(`/batches/${encodeURIComponent(batchId)}/calls`)
            .pipe(
              switchMap(({ items }) =>
                from(items).pipe(
                  mergeMap(
                    (call) =>
                      this.connection.get<CallDto>(
                        `/calls/${encodeURIComponent(call.call_id)}/report`,
                      ),
                    5,
                  ),
                  toArray(),
                  map((results) =>
                    items.map((item) => {
                      const call = results.find((result) => result.call_id === item.call_id)!;
                      if (
                        !call ||
                        call.batch_id !== batchId ||
                        call.stream_id !== context.stream.id
                      )
                        throw new Error('call-context-mismatch');
                      return callFromRest(call);
                    }),
                  ),
                ),
              ),
            ),
        }).pipe(
          map(({ summary, calls }): BatchReportResult => ({
            kind: 'available',
            report: {
              ...context,
              batch: { ...context.batch, averageTotal: summary.average_total },
              summary: summaryFromRest(summary),
              calls,
            },
          })),
          catchError((error) => this.publicationFailure<BatchReportResult>(error, context)),
        );
      }),
      catchError((error) => this.reportFailure<BatchReportResult>(error)),
    );
  }
  callReport(_role: AccessRole, batchId: string, callId: string): Observable<CallReportResult> {
    return this.context(batchId).pipe(
      switchMap((context) => {
        if (context.batch.status !== 'completed')
          return of<CallReportResult>({ kind: 'unavailable', ...context });
        return this.connection.get<CallDto>(`/calls/${encodeURIComponent(callId)}/report`).pipe(
          map((dto) => {
            if (
              dto.batch_id !== batchId ||
              dto.call_id !== callId ||
              dto.stream_id !== context.stream.stream_id
            )
              return { kind: 'not-found' } as const;
            return {
              kind: 'available',
              report: {
                ...context,
                stream: {
                  id: context.stream.stream_id,
                  organizationId: context.stream.customer_id,
                  name: context.stream.name,
                },
                call: callFromRest(dto),
                analysis: analysisFromRest(dto, context.stream),
              },
            } as CallReportResult;
          }),
          catchError((error) => this.publicationFailure<CallReportResult>(error, context)),
        );
      }),
      catchError((error) => this.reportFailure<CallReportResult>(error)),
    );
  }
  compareBatches(
    _role: AccessRole,
    query: BatchQuery,
    batchIds: readonly string[],
  ): Observable<ComparisonResult> {
    const ids = [...new Set(batchIds)];
    if (ids.length < 2)
      return of({
        kind: 'invalid-selection',
        message: 'Выберите минимум два разных завершённых батча.',
      });
    return this.connection
      .post<{ stream_id: string; items: SummaryDto[] }>(
        `/streams/${encodeURIComponent(query.streamId)}/comparisons`,
        { batch_ids: ids },
      )
      .pipe(
        switchMap((response) =>
          forkJoin({
            stream: this.connection.get<StreamDto>(
              `/streams/${encodeURIComponent(query.streamId)}`,
            ),
            batches: forkJoin(
              response.items.map((summary) =>
                this.connection
                  .get<BatchDto>(`/batches/${encodeURIComponent(summary.batch_id)}`)
                  .pipe(
                    map((batch) => ({
                      batch: batchFromRest(batch, summary.average_total),
                      summary: summaryFromRest(summary),
                    })),
                  ),
              ),
            ),
          }),
        ),
        map(
          ({ stream, batches }) =>
            ({
              kind: 'available',
              stream: {
                id: stream.stream_id,
                organizationId: stream.customer_id,
                name: stream.name,
              },
              columns: batches,
            }) as const,
        ),
        catchError((error) => {
          if (error instanceof HttpErrorResponse && [403, 404, 409, 422].includes(error.status)) {
            const code = error.error?.error?.code;
            const message =
              code === 'comparison_stream_mismatch'
                ? 'Выбранные батчи относятся к разным стримам.'
                : code === 'report_not_available'
                  ? 'Не все выбранные батчи имеют опубликованный отчёт.'
                  : error.status === 404 || error.status === 403
                    ? 'Один из выбранных батчей или стрим удалён либо недоступен.'
                    : 'Выберите минимум два разных завершённых батча одного стрима.';
            return of<ComparisonResult>({ kind: 'invalid-selection', message });
          }
          return throwError(() => error);
        }),
      );
  }
  private reportFailure<T extends BatchReportResult | CallReportResult>(
    error: unknown,
  ): Observable<T> {
    if (error instanceof HttpErrorResponse && [403, 404].includes(error.status))
      return of({ kind: 'not-found' } as T);
    return throwError(() => error);
  }
  private publicationFailure<T extends BatchReportResult | CallReportResult>(
    error: unknown,
    context: { batch: Batch; organization: Organization },
  ): Observable<T> {
    if (
      error instanceof HttpErrorResponse &&
      error.status === 409 &&
      error.error?.error?.code === 'report_not_available'
    )
      return of({ kind: 'unavailable', ...context } as T);
    return this.reportFailure<T>(error);
  }
}
