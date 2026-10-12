import { StartBatchesSource, StartBatchResult } from '../batches/admin-batches-source';
import { launchMessage } from '../batches/batch-launch-action';
import { RestStartBatchesSource } from './rest-start-batches-source';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, EMPTY, exhaustMap, filter, Subscription, timer } from 'rxjs';
import { BatchesCatalog } from '../batches/batches-catalog';
import { Batch, Organization } from '../batches/batch-models';
import { BatchTable } from '../batches/batch-table';
import { PublicStream } from '../streams/public-streams-source';
import { ApiConnection, connectionError } from './api-connection';
import { RestBatchesCatalog } from './rest-catalog';
import { WorkspaceShell } from './workspace-shell';
import { PublicStreamCard } from '../streams/public-stream-card';

@Component({
  selector: 'app-workspace-page',
  imports: [RouterLink, WorkspaceShell, BatchTable, PublicStreamCard],
  providers: [
    { provide: BatchesCatalog, useExisting: RestBatchesCatalog },
    { provide: StartBatchesSource, useExisting: RestStartBatchesSource },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace-page.html',
})
export class WorkspacePage {
  private readonly connection = inject(ApiConnection);
  private readonly source = inject(BatchesCatalog);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private request = new Subscription();
  protected readonly role = this.connection.access()!.role;
  protected readonly section = this.route.snapshot.data['section'] as 'batches' | 'streams';
  protected readonly organizations = signal<readonly Organization[]>([]);
  protected readonly organization = signal<Organization | null>(null);
  protected readonly streams = signal<readonly PublicStream[]>([]);
  protected readonly selectedStream = signal('');
  protected readonly batches = signal<readonly Batch[]>([]);
  protected readonly launchNotice = signal('');
  protected readonly launchRefused = signal(false);
  protected launched(result: StartBatchResult): void {
    if (
      result.kind !== 'not-found' &&
      (result.details.organization.id !== this.organization()?.id ||
        result.details.stream.id !== this.selectedStream())
    )
      return;
    this.launchNotice.set(launchMessage(result));
    this.launchRefused.set(result.kind === 'not-found' || result.kind === 'not-ready');
    this.selectStream(this.selectedStream());
  }
  protected readonly status = signal('');
  protected readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly error = signal('');
  protected readonly visibleBatches = () =>
    this.batches().filter((batch) => !this.status() || batch.status === this.status());

  constructor() {
    this.destroyRef.onDestroy(() => this.request.unsubscribe());
    this.loadWorkspace();
  }
  protected loadWorkspace(): void {
    this.request.unsubscribe();
    this.request = new Subscription();
    this.state.set('loading');
    this.organizations.set([]);
    this.organization.set(null);
    this.streams.set([]);
    this.batches.set([]);
    this.request.add(
      this.source.workspace(this.role).subscribe({
        next: (workspace) => {
          this.organizations.set(workspace.organizations);
          const requested =
            this.role === 'team' ? this.route.snapshot.queryParamMap.get('organization') : null;
          const owner =
            workspace.organizations.find((owner) => owner.id === requested) ??
            workspace.organizations[0];
          if (owner) this.selectOrganization(owner.id);
          else this.state.set('ready');
        },
        error: (error) => this.failed(error),
      }),
    );
  }
  protected selectOrganization(id: string): void {
    this.request.unsubscribe();
    this.request = new Subscription();
    const owner = this.organizations().find((organization) => organization.id === id);
    if (!owner) return;
    this.launchNotice.set('');
    this.organization.set(owner);
    this.streams.set([]);
    this.batches.set([]);
    this.selectedStream.set('');
    this.status.set('');
    this.state.set('loading');
    this.request.add(
      this.source.streams(owner.id).subscribe({
        next: (streams) => {
          this.streams.set(streams as readonly PublicStream[]);
          const requested = this.route.snapshot.queryParamMap.get('stream');
          const stream = streams.find((stream) => stream.id === requested) ?? streams[0];
          if (stream && this.section === 'batches') this.selectStream(stream.id);
          else this.state.set('ready');
        },
        error: (error) => this.failed(error),
      }),
    );
  }
  protected selectStream(id: string): void {
    this.request.unsubscribe();
    this.request = new Subscription();
    this.batches.set([]);
    this.state.set('loading');
    if (!this.streams().some((stream) => stream.id === id) || !this.organization()) return;
    this.selectedStream.set(id);
    this.request.add(
      timer(0, 10_000)
        .pipe(
          filter(
            (tick) =>
              tick === 0 ||
              (this.document.visibilityState === 'visible' && this.state() === 'ready'),
          ),
          exhaustMap(() =>
            this.source.batches({ organizationId: this.organization()!.id, streamId: id }).pipe(
              catchError((error) => {
                this.failed(error);
                return EMPTY;
              }),
            ),
          ),
        )
        .subscribe({
          next: (batches) => {
            this.batches.set(batches);
            this.state.set('ready');
          },
        }),
    );
  }
  protected retry(): void {
    if (!this.organization()) this.loadWorkspace();
    else if (!this.streams().length || this.section === 'streams')
      this.selectOrganization(this.organization()!.id);
    else this.selectStream(this.selectedStream());
  }
  private failed(error: unknown): void {
    this.error.set(connectionError(error));
    this.state.set('error');
  }
}
