import { Observable } from 'rxjs';
import { Batch, BatchQuery, AccessRole, Workspace, Stream } from './batch-models';

/** Read-only catalog backed by the REST API. */
export abstract class BatchesCatalog {
  abstract workspace(role: AccessRole): Observable<Workspace>;
  abstract streams(organizationId: string): Observable<readonly Stream[]>;
  abstract batches(query: BatchQuery): Observable<readonly Batch[]>;
}
