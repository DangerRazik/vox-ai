import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, of, Subject, switchMap } from 'rxjs';
import { DemoShell } from '../shared/demo-shell';
import { PublicStreams, PublicStreamsSource } from './public-streams-source';
import { DemoStreamsControls } from './demo-streams-controls';
import { PublicStreamCard } from './public-stream-card';

@Component({
  selector: 'app-public-streams-page',
  imports: [DemoShell, DemoStreamsControls, PublicStreamCard],
  templateUrl: './public-streams-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicStreamsPage {
  private readonly source = inject(PublicStreamsSource);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  protected readonly data = signal<PublicStreams | null>(null);
  protected readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  private readonly reads = new Subject<void>();
  private readonly requestedStream = signal<string | null>(null);
  protected readonly selectedStream = computed(() => {
    const streams = this.data()?.streams ?? [];
    return (
      streams.find((stream) => stream.id === this.requestedStream())?.id ?? streams[0]?.id ?? ''
    );
  });
  protected readonly listQuery = computed(() => ({
    organization: this.data()?.organization.id ?? '',
    stream: this.selectedStream(),
  }));

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.requestedStream.set(params.get('stream'));
    });
    this.reads
      .pipe(
        switchMap(() => {
          this.state.set('loading');
          return this.source.readyStreams().pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => {
        if (data) this.data.set(data);
        this.state.set(data ? 'ready' : 'error');
      });
    this.reload();
  }

  protected reload(): void {
    this.reads.next();
  }
}
