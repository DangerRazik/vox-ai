import { AccessRole } from './batch-models';
import { Observable } from 'rxjs';
import { BatchDetailsResult } from './batch-details';

export abstract class BatchDetailsSource {
  abstract batchDetails(role: AccessRole, batchId: string): Observable<BatchDetailsResult>;
}
