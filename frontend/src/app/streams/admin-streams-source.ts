import { StreamProcessing, StreamMetricSettings } from './stream-processing';
import { Observable } from 'rxjs';
import { PublicStream } from './public-streams-source';
import { CriterionId } from '../reports/report-models';

export interface StreamConfiguration {
  readonly enabledCriteria?: readonly CriterionId[];
  readonly processing?: StreamMetricSettings;
  readonly name: string;
  readonly whisperPrompt: string;
  readonly llmPrompt: string;
  readonly options: PublicStream['options'];
}
export interface StreamMaterials {
  readonly knowledgeBase: File;
  readonly unwantedExpressions: File | null;
  readonly textCorrections: File | null;
}
export interface CreateStreamRequest extends StreamConfiguration {
  readonly organizationId: string;
  readonly materials: StreamMaterials;
}
export interface MaterialMetadata {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly sha256?: string;
}
export interface AdminStream extends PublicStream {
  readonly enabledCriteria?: readonly CriterionId[];
  readonly processing?: StreamProcessing;
  readonly whisperPrompt: string;
  readonly llmPrompt: string;
  readonly materials: {
    readonly knowledgeBase: MaterialMetadata;
    readonly unwantedExpressions: MaterialMetadata | null;
    readonly textCorrections: MaterialMetadata | null;
  };
}
export type DeleteStreamResult =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'busy'; readonly message: string }
  | { readonly kind: 'not-found' };
export interface StreamCreationDefaults {
  readonly whisperPrompt: string;
}
export abstract class AdminStreamsSource {
  abstract creationDefaults(): Observable<StreamCreationDefaults>;
  abstract list(organizationId: string): Observable<readonly AdminStream[]>;
  abstract details(organizationId: string, streamId: string): Observable<AdminStream | null>;
  abstract create(request: CreateStreamRequest): Observable<AdminStream>;
  abstract delete(organizationId: string, streamId: string): Observable<DeleteStreamResult>;
}
