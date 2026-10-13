import { ProcessingAnalytics } from './processing-analytics';
import { TechnicalDetails } from '../shared/technical-details';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ReportsSource } from './reports-source';
import { reportNavigation } from './report-navigation';
import { AccessRole, Organization } from '../batches/batch-models';
import { ReportShell } from '../shared/report-shell';
import { formatNumber } from '../shared/formatting';
import { BatchReportResult } from './report-models';
import { ReportSummary } from './report-summary';
import { CriterionChart } from './criterion-chart';

type ReportState = BatchReportResult | { readonly kind: 'loading' | 'error' };

@Component({
  selector: 'app-batch-report-page',
  imports: [
    RouterLink,
    ReportShell,
    ReportSummary,
    CriterionChart,
    TechnicalDetails,
    ProcessingAnalytics,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './batch-report-page.html',
})
export class BatchReportPage {
  private readonly route = inject(ActivatedRoute);
  private readonly source = inject(ReportsSource);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly role = this.route.snapshot.data['role'] as AccessRole;
  protected readonly navigation = reportNavigation(this.role);
  protected readonly state = signal<ReportState>({ kind: 'loading' });
  private readonly context = signal<{
    batchId: string;
    organization: Organization;
    streamId: string;
  } | null>(null);
  protected readonly number = formatNumber;
  protected readonly listQueryParams = computed(() => {
    const context = this.context();
    return context ? { organization: context.organization.id, stream: context.streamId } : null;
  });
  protected readonly organizationName = computed(() => {
    return (
      this.context()?.organization.name ?? (this.role === 'team' ? 'Команда Vox AI' : 'Заказчик')
    );
  });
  private readonly refresh = new Subject<void>();

  constructor() {
    combineLatest([this.route.paramMap, this.refresh.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          const batchId = params.get('batchId') ?? '';
          if (this.context()?.batchId !== batchId) this.context.set(null);
          this.state.set({ kind: 'loading' });
          return this.source.batchReport(this.role, batchId).pipe(
            map((result): ReportState => result),
            catchError(() => of<ReportState>({ kind: 'error' })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        if (state.kind === 'available') {
          this.context.set({
            batchId: state.report.batch.id,
            organization: state.report.organization,
            streamId: state.report.stream.id,
          });
        } else if (state.kind === 'unavailable') {
          this.context.set({
            batchId: state.batch.id,
            organization: state.organization,
            streamId: state.batch.streamId,
          });
        } else if (state.kind === 'not-found') this.context.set(null);
        this.state.set(state);
      });
  }
  protected reload(): void {
    this.refresh.next();
  }
}
