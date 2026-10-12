import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DemoShell } from './demo-shell';
import { WorkspaceShell } from '../connection/workspace-shell';
import { DemoRole } from '../batches/batch-models';

@Component({
  selector: 'app-report-shell',
  imports: [NgTemplateOutlet, DemoShell, WorkspaceShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #content><ng-content /></ng-template>
    @if (demo()) {
      <app-demo-shell
        [role]="role()"
        [organizationName]="organizationName()"
        [activeSection]="activeSection()"
        [listQueryParams]="listQueryParams()"
      >
        <ng-container [ngTemplateOutlet]="content" />
      </app-demo-shell>
    } @else {
      <app-workspace-shell
        [role]="role()"
        [organizationName]="organizationName()"
        [section]="activeSection()"
        [listQueryParams]="listQueryParams()"
      >
        <ng-container [ngTemplateOutlet]="content" />
      </app-workspace-shell>
    }
  `,
})
export class ReportShell {
  readonly demo = input.required<boolean>();
  readonly role = input.required<DemoRole>();
  readonly organizationName = input.required<string>();
  readonly activeSection = input<'batches' | 'streams' | 'comparison' | 'customers'>('batches');
  readonly listQueryParams = input<{ organization: string; stream: string } | null>(null);
}
