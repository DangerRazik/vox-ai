import { Observable } from 'rxjs';
import { DemoRole } from './batch-models';
import { BatchDetailsResult } from './batch-details';

export abstract class BatchDetailsSource {
  abstract batchDetails(role: DemoRole, batchId: string): Observable<BatchDetailsResult>;
}
