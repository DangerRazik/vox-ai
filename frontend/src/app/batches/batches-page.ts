import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, Subject, switchMap } from 'rxjs';
import { Batch, BatchQuery, DemoRole, Organization, Stream } from './batch-models';
import { BatchesSource } from './batches-source';
import { BatchTable } from './batch-table';
import { DemoStateControls } from './demo-state-controls';
import { DemoShell } from '../shared/demo-shell';
import { AdminBatchQueue } from './admin-batch-queue';
import { StartBatchResult } from './admin-batches-source';
import { launchMessage } from './batch-launch-action';
import { DemoAccess } from '../shared/demo-access';

type ListState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'ready'; batches: readonly Batch[] };

@Component({
  selector: 'app-batches-page',
  imports: [BatchTable, DemoStateControls, DemoShell, RouterLink, AdminBatchQueue],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './batches-page.html',
})
export class BatchesPage {
  protected readonly access = inject(DemoAccess);
  private readonly source = inject(BatchesSource);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  protected readonly role = this.route.snapshot.data['role'] as DemoRole;
  protected readonly organizations = signal<readonly Organization[]>([]);
  protected readonly streams = signal<readonly Stream[]>([]);
  protected readonly organizationId = signal('');
  protected readonly streamId = signal('');
  protected readonly state = signal<ListState>({ kind: 'loading' });
  protected readonly queueRefresh = signal(0);
  protected readonly launchNotice = signal('');
  protected launched(result: StartBatchResult): void {
    this.launchNotice.set(launchMessage(result));
    this.queueRefresh.update((value) => value + 1);
    this.reload();
  }
  private readonly queries = new Subject<BatchQuery>();

  constructor() {
    this.queries
      .pipe(
        switchMap((query) => {
          this.state.set({ kind: 'loading' });
          return this.source.batches(query).pipe(
            map((batches): ListState =>
              batches.length ? { kind: 'ready', batches } : { kind: 'empty' },
            ),
            catchError(() => of<ListState>({ kind: 'error' })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.state.set(state));

    this.source
      .workspace(this.role)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (workspace) => {
          this.organizations.set(workspace.organizations);
          const selected = this.route.snapshot.queryParamMap.get('organization');
          this.selectOrganization(
            workspace.organizations.find((item) => item.id === selected)?.id ??
              workspace.organizations[0]?.id ??
              '',
          );
        },
        error: () => this.state.set({ kind: 'error' }),
      });
  }

  protected organizationName(): string {
    return (
      this.organizations().find((organization) => organization.id === this.organizationId())
        ?.name ?? ''
    );
  }

  protected selectOrganization(id: string): void {
    this.organizationId.set(id);
    this.streamId.set('');
    this.streams.set([]);
    this.state.set({ kind: 'loading' });
    this.source
      .streams(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (streams) => {
          this.streams.set(streams);
          const selected = this.route.snapshot.queryParamMap.get('stream');
          this.selectStream(
            streams.find((item) => item.id === selected)?.id ?? streams[0]?.id ?? '',
          );
        },
        error: () => this.state.set({ kind: 'error' }),
      });
  }

  protected selectStream(id: string): void {
    this.streamId.set(id);
    if (id) this.reload();
    else this.state.set({ kind: 'empty' });
  }

  protected reload(): void {
    this.queries.next({ organizationId: this.organizationId(), streamId: this.streamId() });
  }
}
