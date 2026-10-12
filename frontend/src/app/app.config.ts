import { BatchDetailsSource } from './batches/batch-details-source';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { BatchesSource } from './batches/batches-source';
import { DemoBatchesSource } from './batches/demo-batches-source';
import { UploadsSource } from './uploads/upload-models';
import { DemoUploadsSource } from './uploads/demo-uploads-source';
import { PublicStreamsSource } from './streams/public-streams-source';
import { DemoPublicStreamsSource } from './streams/demo-public-streams-source';
import { CustomersSource } from './customers/customers-source';
import { DemoCustomersSource } from './customers/demo-customers-source';
import { AdminStreamsSource } from './streams/admin-streams-source';
import { DemoAdminStreamsSource } from './streams/demo-admin-streams-source';
import { AdminBatchesSource, StartBatchesSource } from './batches/admin-batches-source';
import { BatchesCatalog } from './batches/batches-catalog';
import { ReportsSource } from './reports/reports-source';
import { DemoAdminBatchesSource } from './batches/demo-admin-batches-source';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    { provide: BatchDetailsSource, useExisting: DemoBatchesSource },
    { provide: BatchesCatalog, useExisting: DemoBatchesSource },
    { provide: ReportsSource, useExisting: DemoBatchesSource },
    { provide: AdminBatchesSource, useExisting: DemoAdminBatchesSource },
    { provide: StartBatchesSource, useExisting: DemoAdminBatchesSource },
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: BatchesSource, useExisting: DemoBatchesSource },
    { provide: UploadsSource, useExisting: DemoUploadsSource },
    { provide: PublicStreamsSource, useExisting: DemoPublicStreamsSource },
    { provide: CustomersSource, useExisting: DemoCustomersSource },
    { provide: AdminStreamsSource, useExisting: DemoAdminStreamsSource },
  ],
};
