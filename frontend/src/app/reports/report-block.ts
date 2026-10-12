import { ChangeDetectionStrategy, Component, input, OnInit, signal } from '@angular/core';

@Component({
  selector: 'app-report-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="call-block collapsible-block" [attr.aria-label]="title()">
      <h2 class="block-heading">
        <button
          type="button"
          class="block-toggle"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="'report-content-' + preferenceKey()"
          (click)="toggle()"
        >
          {{ title() }}<span aria-hidden="true">{{ expanded() ? '−' : '+' }}</span>
        </button>
      </h2>
      <div [id]="'report-content-' + preferenceKey()" [hidden]="!expanded()">
        <ng-content />
      </div>
    </section>
  `,
})
export class ReportBlock implements OnInit {
  readonly title = input.required<string>();
  readonly preferenceKey = input.required<string>();
  protected readonly expanded = signal(true);
  ngOnInit(): void {
    try {
      this.expanded.set(localStorage.getItem(this.storageKey()) !== 'collapsed');
    } catch {}
  }
  protected toggle(): void {
    this.expanded.update((value) => !value);
    try {
      localStorage.setItem(this.storageKey(), this.expanded() ? 'expanded' : 'collapsed');
    } catch {}
  }
  private storageKey(): string {
    return 'vox.report-block.' + this.preferenceKey();
  }
}
