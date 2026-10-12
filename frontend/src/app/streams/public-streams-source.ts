import { Observable } from 'rxjs';
import { Organization, Stream } from '../batches/batch-models';
import { CriterionId } from '../reports/report-models';

export interface PublicStream extends Stream {
  readonly createdAt: string;
  readonly options: {
    readonly tempoAnalysis: boolean;
    readonly unwantedExpressions: boolean;
    readonly textCorrections: boolean;
    readonly zeroTotalOnCritical: boolean;
  };
  readonly criteria: readonly { readonly id: CriterionId; readonly name: string }[];
}

export interface PublicStreams {
  readonly organization: Organization;
  readonly streams: readonly PublicStream[];
}

export abstract class PublicStreamsSource {
  // Организация определяется контекстом подключения, а не параметрами URL.
  abstract readyStreams(organizationId?: string): Observable<PublicStreams>;
}
