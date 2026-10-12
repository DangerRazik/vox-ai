import { Observable } from 'rxjs';
import { Batch, BatchQuery, DemoRole, DemoWorkspace, Stream } from './batch-models';

/** Read-only catalog shared by the demo and REST stages. */
export abstract class BatchesCatalog {
  abstract workspace(role: DemoRole): Observable<DemoWorkspace>;
  abstract streams(organizationId: string): Observable<readonly Stream[]>;
  abstract batches(query: BatchQuery): Observable<readonly Batch[]>;
}
