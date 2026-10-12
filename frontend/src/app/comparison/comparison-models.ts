import { Batch, Stream } from '../batches/batch-models';
import { BatchSummary } from '../reports/report-models';

export interface ComparisonColumn {
  readonly batch: Batch;
  readonly summary: BatchSummary;
}
export type ComparisonResult =
  | {
      readonly kind: 'available';
      readonly stream: Stream;
      readonly columns: readonly ComparisonColumn[];
    }
  | { readonly kind: 'invalid-selection'; readonly message: string };
