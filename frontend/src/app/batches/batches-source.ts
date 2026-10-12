import { Observable } from 'rxjs';
import { BatchQuery, DemoRole } from './batch-models';
import { BatchReportResult, CallReportResult } from '../reports/report-models';
import { BatchDetailsResult } from './batch-details';
import { ComparisonResult } from '../comparison/comparison-models';
import { BatchesCatalog } from './batches-catalog';

export abstract class BatchesSource extends BatchesCatalog {
  abstract compareBatches(
    role: DemoRole,
    query: BatchQuery,
    batchIds: readonly string[],
  ): Observable<ComparisonResult>;
  abstract batchDetails(role: DemoRole, batchId: string): Observable<BatchDetailsResult>;
  abstract batchReport(role: DemoRole, batchId: string): Observable<BatchReportResult>;
  abstract callReport(
    role: DemoRole,
    batchId: string,
    callId: string,
  ): Observable<CallReportResult>;
}
