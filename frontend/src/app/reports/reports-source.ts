import { Observable } from 'rxjs';
import { BatchQuery, DemoRole } from '../batches/batch-models';
import { ComparisonResult } from '../comparison/comparison-models';
import { BatchReportResult, CallReportResult } from './report-models';

export abstract class ReportsSource {
  abstract batchReport(role: DemoRole, batchId: string): Observable<BatchReportResult>;
  abstract callReport(
    role: DemoRole,
    batchId: string,
    callId: string,
  ): Observable<CallReportResult>;
  abstract compareBatches(
    role: DemoRole,
    query: BatchQuery,
    batchIds: readonly string[],
  ): Observable<ComparisonResult>;
}
