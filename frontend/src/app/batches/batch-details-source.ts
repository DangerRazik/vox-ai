import { AccessRole } from './batch-models';
import { Observable } from 'rxjs';
import { BatchDetailsResult } from './batch-details';

export abstract class BatchDetailsSource {
  abstract setPaused(batchId: string, paused: boolean): Observable<BatchDetailsResult>;
  abstract batchDetails(role: AccessRole, batchId: string): Observable<BatchDetailsResult>;
}
