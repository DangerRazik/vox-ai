import { inject, Injectable } from '@angular/core';
import { defer, map, Observable, switchMap, timer } from 'rxjs';
import { DemoBatchesSource } from '../batches/demo-batches-source';
import { DemoStreamCatalog } from './demo-stream-catalog';
import { PublicStreams, PublicStreamsSource } from './public-streams-source';

@Injectable({ providedIn: 'root' })
export class DemoPublicStreamsSource extends PublicStreamsSource {
  private readonly batches = inject(DemoBatchesSource);
  private readonly catalog = inject(DemoStreamCatalog);
  private failNextRead = false;
  private emptyNextRead = false;

  simulateNextError(): void {
    this.failNextRead = true;
  }

  simulateNextEmptyList(): void {
    this.emptyNextRead = true;
  }

  override readyStreams(): Observable<PublicStreams> {
    return defer(() => {
      const fail = this.failNextRead;
      const empty = this.emptyNextRead;
      this.failNextRead = false;
      this.emptyNextRead = false;
      return this.batches.workspace('customer').pipe(
        switchMap(({ organizations }) => {
          const organization = organizations[0]!;
          return this.batches.streams(organization.id).pipe(
            switchMap((streams) =>
              timer(350).pipe(
                map(() => {
                  if (fail) throw new Error('Демонстрационная ошибка чтения стримов');
                  return {
                    organization,
                    streams: (empty ? [] : streams).map((stream) => {
                      const snapshot = this.catalog.all().find((item) => item.id === stream.id)!;
                      return {
                        id: snapshot.id,
                        organizationId: snapshot.organizationId,
                        name: snapshot.name,
                        createdAt: snapshot.createdAt,
                        options: snapshot.options,
                        criteria: snapshot.criteria,
                      };
                    }),
                  };
                }),
              ),
            ),
          );
        }),
      );
    });
  }
}
