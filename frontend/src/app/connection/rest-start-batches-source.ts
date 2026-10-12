import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { StartBatchesSource, StartBatchResult } from '../batches/admin-batches-source';
import { ApiConnection } from './api-connection';
import { RestBatchDetailsSource } from './rest-uploads-source';

@Injectable({ providedIn: 'root' })
export class RestStartBatchesSource extends StartBatchesSource {
  private readonly connection = inject(ApiConnection);
  private readonly details = inject(RestBatchDetailsSource);
  start(batchId: string): Observable<StartBatchResult> {
    return this.connection
      .postResponse(`/admin/batches/${encodeURIComponent(batchId)}/start`, {})
      .pipe(
        map((response) => (response.status === 202 ? ('accepted' as const) : ('current' as const))),
        catchError((error) =>
          error instanceof HttpErrorResponse && error.status === 409
            ? of('not-ready' as const)
            : throwError(() => error),
        ),
        switchMap((kind) =>
          this.details
            .batchDetails('team', batchId)
            .pipe(
              map((result) =>
                result.kind === 'available' ? { kind, details: result.details } : result,
              ),
            ),
        ),
        catchError((error) =>
          error instanceof HttpErrorResponse && error.status === 404
            ? of<StartBatchResult>({ kind: 'not-found' })
            : throwError(() => error),
        ),
      );
  }
}
