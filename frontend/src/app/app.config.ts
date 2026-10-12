import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { BatchDetailsSource } from './batches/batch-details-source';
import { RestBatchDetailsSource, RestUploadsSource } from './connection/rest-uploads-source';
import { BatchesCatalog } from './batches/batches-catalog';
import { RestBatchesCatalog } from './connection/rest-catalog';
import { ReportsSource } from './reports/reports-source';
import { RestReportsSource } from './connection/rest-reports-source';
import { StartBatchesSource } from './batches/admin-batches-source';
import { RestStartBatchesSource } from './connection/rest-start-batches-source';
import { UploadsSource } from './uploads/upload-models';
import { CustomersSource } from './customers/customers-source';
import { RestCustomersSource } from './connection/rest-customers-source';
import { AdminStreamsSource } from './streams/admin-streams-source';
import { RestAdminStreamsSource } from './connection/rest-admin-streams-source';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: BatchDetailsSource, useExisting: RestBatchDetailsSource },
    { provide: BatchesCatalog, useExisting: RestBatchesCatalog },
    { provide: ReportsSource, useExisting: RestReportsSource },
    { provide: StartBatchesSource, useExisting: RestStartBatchesSource },
    { provide: UploadsSource, useExisting: RestUploadsSource },
    { provide: CustomersSource, useExisting: RestCustomersSource },
    { provide: AdminStreamsSource, useExisting: RestAdminStreamsSource },
  ],
};
