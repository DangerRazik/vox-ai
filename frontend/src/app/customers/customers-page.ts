import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, Subject, switchMap } from 'rxjs';
import { Organization } from '../batches/batch-models';
import { ReportShell } from '../shared/report-shell';
import { reportNavigation } from '../reports/report-navigation';
import { adminOperationError } from '../connection/admin-operation-error';
import { CreatedCustomer, CustomersSource } from './customers-source';
import { CustomerForm } from './customer-form';
import { CustomerReceipt } from './customer-receipt';

type ListState =
  { kind: 'loading' | 'error' } | { kind: 'ready'; customers: readonly Organization[] };
@Component({
  selector: 'app-customers-page',
  imports: [RouterLink, ReportShell, CustomerForm, CustomerReceipt],
  templateUrl: './customers-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomersPage {
  protected readonly navigation = reportNavigation('team');
  private readonly source = inject(CustomersSource);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reads = new Subject<void>();
  protected readonly state = signal<ListState>({ kind: 'loading' });
  protected readonly created = signal<CreatedCustomer | null>(null);
  protected readonly creating = signal(false);
  protected readonly createError = signal('');
  protected readonly createNameError = signal('');
  protected readonly focusNewCustomer = signal(false);
  constructor() {
    this.reads
      .pipe(
        switchMap(() => {
          this.state.set({ kind: 'loading' });
          return this.source.list().pipe(
            map((customers): ListState => ({ kind: 'ready', customers })),
            catchError(() => of<ListState>({ kind: 'error' })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.state.set(state));
    this.reload();
  }
  protected reload(): void {
    this.reads.next();
  }
  protected closeReceipt(): void {
    this.created.set(null);
    this.focusNewCustomer.set(true);
  }
  protected create(name: string): void {
    if (this.creating() || this.created()) return;
    this.createError.set('');
    this.createNameError.set('');
    this.creating.set(true);
    this.source
      .create(name)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.created.set(result);
          this.creating.set(false);
          this.reload();
        },
        error: (error) => {
          this.creating.set(false);
          if (error instanceof HttpErrorResponse && error.status === 422) {
            this.createNameError.set(
              'Сервер отклонил название. Укажите непустое имя до 200 символов.',
            );
            return;
          }
          this.createError.set(adminOperationError(error));
        },
      });
  }
}
