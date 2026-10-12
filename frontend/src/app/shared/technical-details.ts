import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface TechnicalId {
  label: string;
  value: string | null | undefined;
  testId?: string;
}

@Component({
  selector: 'app-technical-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; margin-top: 16px; }
    p { margin: 0; font-size: 11px; line-height: 1.6; color: #77818f; }
    span { display: inline-block; margin-right: 16px; overflow-wrap: anywhere; max-width: 100%; }
    code { font: inherit; user-select: text; }
  `,
  template: `
    <p>
      @for (item of ids(); track item.label) {
        @if (item.value; as value) {
          <span>{{ item.label }}: <code [attr.data-testid]="item.testId">{{ value }}</code></span>
        }
      }
    </p>
  `,
})
export class TechnicalDetails {
  readonly ids = input.required<readonly TechnicalId[]>();
}
