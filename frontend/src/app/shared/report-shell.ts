import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { WorkspaceShell } from '../connection/workspace-shell';
import { AccessRole } from '../batches/batch-models';

@Component({
  selector: 'app-report-shell',
  imports: [WorkspaceShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-workspace-shell
      [role]="role()"
      [organizationName]="organizationName()"
      [section]="activeSection()"
      [listQueryParams]="listQueryParams()"
      ><ng-content
    /></app-workspace-shell>
  `,
})
export class ReportShell {
  readonly role = input.required<AccessRole>();
  readonly organizationName = input.required<string>();
  readonly activeSection = input<'batches' | 'streams' | 'comparison' | 'customers'>('batches');
  readonly listQueryParams = input<{ organization: string; stream: string } | null>(null);
}
