import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap } from 'rxjs';
import { BatchesCatalog } from '../batches/batches-catalog';
import {
  Batch,
  BatchQuery,
  BATCH_STATUSES,
  DemoRole,
  DemoWorkspace,
} from '../batches/batch-models';
import { PublicStream, PublicStreams, PublicStreamsSource } from '../streams/public-streams-source';
import { CriterionId } from '../reports/report-models';
import { ApiConnection } from './api-connection';
import { BatchDto, batchFromRest } from './rest-report-models';

interface CustomerDto {
  customer_id: string;
  name: string;
}
interface StreamDto {
  stream_id: string;
  customer_id: string;
  name: string;
  created_at: string;
  options: {
    speech_rate_enabled: boolean;
    unwanted_expressions_enabled: boolean;
    text_correction_enabled: boolean;
    zero_total_on_critical: boolean;
  };
  criteria: { id: CriterionId; title: string }[];
}
interface SummaryDto {
  batch_id: string;
  average_total: number | null;
}

@Injectable({ providedIn: 'root' })
export class RestPublicStreamsSource extends PublicStreamsSource {
  private readonly connection = inject(ApiConnection);
  readyStreams(organizationId?: string): Observable<PublicStreams> {
    const access = this.connection.access()!;
    const owner = access.organization?.id ?? organizationId;
    if (!owner) throw new Error('organization-required');
    const organization = access.organization ?? { id: owner, name: '' };
    return this.connection
      .get<{ items: StreamDto[] }>('/streams', new HttpParams().set('customer_id', owner))
      .pipe(
        map((response) => ({
          organization,
          streams: response.items.map((stream) => ({
            id: stream.stream_id,
            organizationId: stream.customer_id,
            name: stream.name,
            createdAt: stream.created_at,
            criteria: stream.criteria.map((c) => ({ id: c.id, name: c.title })),
            options: {
              tempoAnalysis: stream.options.speech_rate_enabled,
              unwantedExpressions: stream.options.unwanted_expressions_enabled,
              textCorrections: stream.options.text_correction_enabled,
              zeroTotalOnCritical: stream.options.zero_total_on_critical,
            },
          })),
        })),
      );
  }
}

@Injectable({ providedIn: 'root' })
export class RestBatchesCatalog extends BatchesCatalog {
  private readonly connection = inject(ApiConnection);
  private readonly publicStreams = inject(RestPublicStreamsSource);
  workspace(_role: DemoRole): Observable<DemoWorkspace> {
    const access = this.connection.access()!;
    if (access.organization) return of({ role: access.role, organizations: [access.organization] });
    return this.connection.get<{ items: CustomerDto[] }>('/admin/customers').pipe(
      map((response) => ({
        role: access.role,
        organizations: response.items.map((customer) => ({
          id: customer.customer_id,
          name: customer.name,
        })),
      })),
    );
  }
  streams(organizationId: string): Observable<readonly PublicStream[]> {
    return this.publicStreams.readyStreams(organizationId).pipe(map((result) => result.streams));
  }
  batches(query: BatchQuery): Observable<readonly Batch[]> {
    const owner = this.connection.access()!.organization?.id ?? query.organizationId;
    return this.connection
      .get<{ items: BatchDto[] }>(
        '/batches',
        new HttpParams().set('customer_id', owner).set('stream_id', query.streamId),
      )
      .pipe(
        switchMap((response) => {
          const summaries = response.items.some((batch) => batch.status === 'completed')
            ? this.connection.get<{ items: SummaryDto[] }>(
                `/streams/${encodeURIComponent(query.streamId)}/dashboard`,
              )
            : of({ items: [] as SummaryDto[] });
          return summaries.pipe(
            map((published) =>
              response.items.map((batch) => {
                if (!Object.hasOwn(BATCH_STATUSES, batch.status))
                  throw new Error('unknown-batch-status');
                const summary = published.items.find((item) => item.batch_id === batch.batch_id);
                if (batch.status === 'completed' && !summary)
                  throw new Error('unpublished-completed-batch');
                return batchFromRest(
                  batch,
                  batch.status === 'completed' ? summary!.average_total : null,
                );
              }),
            ),
          );
        }),
      );
  }
}
