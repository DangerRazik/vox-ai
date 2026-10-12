import { StartBatchesSource } from './batches/admin-batches-source';
import { RestStartBatchesSource } from './connection/rest-start-batches-source';
import { BatchDetailsSource } from './batches/batch-details-source';
import { RestBatchDetailsSource, RestUploadsSource } from './connection/rest-uploads-source';
import { UploadsSource } from './uploads/upload-models';
import { CustomersSource } from './customers/customers-source';
import { RestCustomersSource } from './connection/rest-customers-source';
import { AdminStreamsSource } from './streams/admin-streams-source';
import { RestAdminStreamsSource } from './connection/rest-admin-streams-source';
import { Routes } from '@angular/router';
import { connectedOnly } from './connection/api-connection';
import { ReportsSource } from './reports/reports-source';
import { RestReportsSource } from './connection/rest-reports-source';
import { BatchesCatalog } from './batches/batches-catalog';
import { RestBatchesCatalog } from './connection/rest-catalog';

export const routes: Routes = [
  ...[
    {
      path: 'team/streams/new',
      loadComponent: () => import('./streams/new-stream-page').then((m) => m.NewStreamPage),
    },
    {
      path: 'team/streams/:streamId',
      loadComponent: () =>
        import('./streams/admin-stream-details-page').then((m) => m.AdminStreamDetailsPage),
    },
    {
      path: 'team/streams',
      loadComponent: () => import('./streams/admin-streams-page').then((m) => m.AdminStreamsPage),
    },
  ].map((route) => ({
    ...route,
    data: { role: 'team' },
    canActivate: [connectedOnly],
    providers: [
      { provide: CustomersSource, useExisting: RestCustomersSource },
      { provide: AdminStreamsSource, useExisting: RestAdminStreamsSource },
    ],
  })),
  {
    path: 'team/customers',
    data: { role: 'team' },
    canActivate: [connectedOnly],
    providers: [{ provide: CustomersSource, useExisting: RestCustomersSource }],
    loadComponent: () => import('./customers/customers-page').then((m) => m.CustomersPage),
  },
  {
    path: 'customer/upload',
    data: { role: 'customer' },
    canActivate: [connectedOnly],
    loadComponent: () => import('./connection/rest-upload-page').then((m) => m.RestUploadPage),
  },
  ...(['customer', 'team'] as const).map((role) => ({
    path: `${role}/batches/:batchId/state`,
    data: { role },
    canActivate: [connectedOnly],
    providers: [
      { provide: BatchDetailsSource, useExisting: RestBatchDetailsSource },
      { provide: UploadsSource, useExisting: RestUploadsSource },
      { provide: StartBatchesSource, useExisting: RestStartBatchesSource },
    ],
    loadComponent: () => import('./batches/batch-state-page').then((m) => m.BatchStatePage),
  })),
  ...(['customer', 'team'] as const).flatMap((role) => [
    {
      path: `${role}/batches/:batchId/report`,
      data: { role },
      canActivate: [connectedOnly],
      providers: [{ provide: ReportsSource, useExisting: RestReportsSource }],
      loadComponent: () => import('./reports/batch-report-page').then((m) => m.BatchReportPage),
    },
    {
      path: `${role}/batches/:batchId/calls/:callId`,
      data: { role },
      canActivate: [connectedOnly],
      providers: [{ provide: ReportsSource, useExisting: RestReportsSource }],
      loadComponent: () => import('./reports/call-report-page').then((m) => m.CallReportPage),
    },
  ]),
  {
    path: 'customer/comparison',
    data: { role: 'customer' },
    canActivate: [connectedOnly],
    providers: [
      { provide: ReportsSource, useExisting: RestReportsSource },
      { provide: BatchesCatalog, useExisting: RestBatchesCatalog },
    ],
    loadComponent: () => import('./comparison/comparison-page').then((m) => m.ComparisonPage),
  },
  {
    path: 'connect',
    loadComponent: () => import('./connection/connection-page').then((m) => m.ConnectionPage),
  },
  ...(['customer', 'team'] as const).flatMap((role) =>
    (['batches', 'streams'] as const).map((section) => ({
      path: `${role}/${section}`,
      data: { role, section },
      canActivate: [connectedOnly],
      loadComponent: () => import('./connection/workspace-page').then((m) => m.WorkspacePage),
    })),
  ),
  { path: '', pathMatch: 'full', redirectTo: 'connect' },
  { path: '**', redirectTo: 'connect' },
];
