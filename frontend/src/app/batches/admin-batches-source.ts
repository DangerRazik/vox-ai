import { Observable } from 'rxjs';
import { BatchDetails } from './batch-details';

export type StartBatchResult =
  | { readonly kind: 'accepted' | 'current' | 'not-ready'; readonly details: BatchDetails }
  | { readonly kind: 'not-found' };

export abstract class StartBatchesSource {
  abstract start(batchId: string): Observable<StartBatchResult>;
}
