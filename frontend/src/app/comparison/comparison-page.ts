import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, map, of, Subject, switchMap } from 'rxjs';
import { Batch, BatchQuery, Organization, Stream } from '../batches/batch-models';
import { BatchesCatalog } from '../batches/batches-catalog';
import { ReportsSource } from '../reports/reports-source';
import { reportNavigation } from '../reports/report-navigation';
import { ReportShell } from '../shared/report-shell';
import { ComparisonResult } from './comparison-models';
import { ComparisonTable } from './comparison-table';

interface Catalog {
  organization: Organization;
  streams: readonly Stream[];
  stream: Stream | null;
  batches: readonly Batch[];
}
type TableState = ComparisonResult | { kind: 'idle' | 'loading' | 'error' };

@Component({
  selector: 'app-comparison-page',
  imports: [ReportShell, ComparisonTable],
  templateUrl: './comparison-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonPage {
  private readonly source = inject(BatchesCatalog);
  private readonly route = inject(ActivatedRoute);
  private readonly reports = inject(ReportsSource);
  protected readonly navigation = reportNavigation('customer');
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly resultPanel = viewChild<ElementRef<HTMLElement>>('resultPanel');
  private requestedStream = this.route.snapshot.queryParamMap.get('stream');
  private readonly requestedBatches = this.route.snapshot.queryParamMap.getAll('batch');
  private initialSelection = true;
  private readonly reads = new Subject<void>();
  private readonly comparisons = new Subject<{
    query: BatchQuery;
    ids: readonly string[];
  } | null>();
  protected readonly catalog = signal<Catalog | null>(null);
  protected readonly catalogState = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly selectedIds = signal<readonly string[]>([]);
  protected readonly selectionNotice = signal('');
  protected readonly tableState = signal<TableState>({ kind: 'idle' });
  protected readonly listQuery = computed(() => ({
    organization: this.catalog()?.organization.id ?? '',
    stream: this.catalog()?.stream?.id ?? '',
  }));

  constructor() {
    this.comparisons
      .pipe(
        switchMap((request) => {
          if (!request) return of<TableState>({ kind: 'idle' });
          this.tableState.set({ kind: 'loading' });
          return this.reports
            .compareBatches('customer', request.query, request.ids)
            .pipe(catchError(() => of<TableState>({ kind: 'error' })));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        this.tableState.set(state);
        if (state.kind === 'available') {
          afterNextRender(
            () => {
              if (this.tableState().kind === 'available') this.resultPanel()?.nativeElement.focus();
            },
            { injector: this.injector },
          );
        }
      });
    this.reads
      .pipe(
        switchMap(() => {
          this.catalogState.set('loading');
          this.comparisons.next(null);
          return this.source.workspace('customer').pipe(
            switchMap(({ organizations }) => {
              const organization = organizations[0]!;
              return this.source.streams(organization.id).pipe(
                switchMap((streams) => {
                  const stream =
                    streams.find((item) => item.id === this.requestedStream) ?? streams[0] ?? null;
                  if (!stream) return of<Catalog>({ organization, streams, stream, batches: [] });
                  return this.source
                    .batches({ organizationId: organization.id, streamId: stream.id })
                    .pipe(
                      map((batches): Catalog => ({
                        organization,
                        streams,
                        stream,
                        batches: batches.filter(
                          (batch) =>
                            batch.status === 'completed' &&
                            batch.organizationId === organization.id &&
                            batch.streamId === stream.id,
                        ),
                      })),
                    );
                }),
              );
            }),
            catchError(() => of(null)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((catalog) => {
        if (catalog) {
          const ids = this.initialSelection ? this.requestedBatches : this.selectedIds();
          const allowed = [...new Set(ids)].filter((id) =>
            catalog.batches.some((batch) => batch.id === id),
          );
          this.selectionNotice.set(
            allowed.length < new Set(ids).size
              ? 'Некоторые батчи недоступны для сравнения: нужны завершённые батчи текущего стрима и организации.'
              : '',
          );
          this.selectedIds.set(allowed);
          this.initialSelection = false;
          this.catalog.set(catalog);
        }
        this.catalogState.set(catalog ? 'ready' : 'error');
      });
    this.reload();
  }
  protected reload(): void {
    this.reads.next();
  }
  protected selectStream(id: string): void {
    this.requestedStream = id;
    this.initialSelection = false;
    this.selectedIds.set([]);
    this.reload();
  }
  protected selectBatch(id: string, checked: boolean): void {
    this.comparisons.next(null);
    this.selectedIds.update((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id),
    );
  }
  protected compare(): void {
    const catalog = this.catalog();
    if (!catalog?.stream || this.selectedIds().length < 2) return;
    this.comparisons.next({
      query: { organizationId: catalog.organization.id, streamId: catalog.stream.id },
      ids: this.selectedIds(),
    });
  }
}
