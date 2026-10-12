import { Batch } from '../batches/batch-models';
import { Observable } from 'rxjs';
import { BatchDetails } from '../batches/batch-details';

export interface UploadFieldError {
  field: 'archive' | 'metadata';
  message: string;
}
export interface UploadFiles {
  streamId: string;
  archive: File;
  metadata: File | null;
}
export interface UploadRequest extends UploadFiles {
  organizationId: string;
  uploadId: string;
}
export interface UploadResult {
  uploadId: string;
  batch: Batch;
  accepted: readonly string[];
  duplicates: readonly { filename: string; original: string }[];
  errors: readonly { filename: string; reason: string }[];
}
export abstract class UploadsSource {
  abstract upload(request: UploadRequest): Observable<UploadResult>;
  abstract restore(request: RestoreRequest): Observable<RestoreResult>;
}

export interface RestoreRequest extends UploadRequest {
  readonly batchId: string;
}
export type RestoreResult =
  | { readonly kind: 'restored'; readonly details: BatchDetails }
  | {
      readonly kind: 'conflict';
      readonly details: BatchDetails;
      readonly message: string;
      readonly fieldError?: UploadFieldError | null;
    };
