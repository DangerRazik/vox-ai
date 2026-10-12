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
import { AccessRole, Organization } from '../batches/batch-models';
import { ReportsSource } from './reports-source';
import { reportNavigation } from './report-navigation';
import { ReportShell } from '../shared/report-shell';
import { formatBoundary, formatDateTime, formatNumber } from '../shared/formatting';
import { CallReportResult } from './report-models';
import { CallGrades } from './call-grades';
import { ReportBlock } from './report-block';
import { SPEAKER_LABELS } from './speaker-roles';

type CallState = CallReportResult | { readonly kind: 'loading' | 'error' };
@Component({
  selector: 'app-call-report-page',
  imports: [RouterLink, ReportShell, CallGrades, ReportBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './call-report-page.html',
})
export class CallReportPage {
  private readonly route = inject(ActivatedRoute);
  private readonly source = inject(ReportsSource);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly role = this.route.snapshot.data['role'] as AccessRole;
  protected readonly navigation = reportNavigation(this.role);
  protected readonly state = signal<CallState>({ kind: 'loading' });
  private readonly context = signal<{
    key: string;
    batchId: string;
    organization: Organization;
    streamId: string;
  } | null>(null);
  protected readonly batchId = signal('');
  protected readonly organizationName = computed(
    () =>
      this.context()?.organization.name ?? (this.role === 'team' ? 'Команда Vox AI' : 'Заказчик'),
  );
  protected readonly listQueryParams = computed(() => {
    const context = this.context();
    return context ? { organization: context.organization.id, stream: context.streamId } : null;
  });
  protected readonly number = formatNumber;
  protected readonly boundary = formatBoundary;
  protected readonly date = formatDateTime;
  protected readonly roles = SPEAKER_LABELS;
  private readonly refresh = new Subject<void>();

  constructor() {
    combineLatest([this.route.paramMap, this.refresh.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          const batchId = params.get('batchId') ?? '';
          const callId = params.get('callId') ?? '';
          const key = `${batchId}/${callId}`;
          if (this.context()?.key !== key) this.context.set(null);
          this.batchId.set(batchId);
          this.state.set({ kind: 'loading' });
          return this.source.callReport(this.role, batchId, callId).pipe(
            map((result): CallState => result),
            catchError(() => of<CallState>({ kind: 'error' })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        if (state.kind === 'available' || state.kind === 'unavailable') {
          const batch = state.kind === 'available' ? state.report.batch : state.batch;
          const organization =
            state.kind === 'available' ? state.report.organization : state.organization;
          this.context.set({
            key: `${batch.id}/${this.route.snapshot.paramMap.get('callId') ?? ''}`,
            batchId: batch.id,
            organization,
            streamId: batch.streamId,
          });
        } else if (state.kind === 'not-found') this.context.set(null);
        this.state.set(state);
      });
  }
  protected reload(): void {
    this.refresh.next();
  }
}
