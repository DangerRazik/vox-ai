import { Observable } from 'rxjs';
import { BatchQuery, AccessRole } from '../batches/batch-models';
import { ComparisonResult } from '../comparison/comparison-models';
import { BatchReportResult, CallReportResult } from './report-models';

export abstract class ReportsSource {
  abstract batchReport(role: AccessRole, batchId: string): Observable<BatchReportResult>;
  abstract callReport(
    role: AccessRole,
    batchId: string,
    callId: string,
  ): Observable<CallReportResult>;
  abstract compareBatches(
    role: AccessRole,
    query: BatchQuery,
    batchIds: readonly string[],
  ): Observable<ComparisonResult>;
}
