import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { Organization } from '../batches/batch-models';
import { CreatedCustomer, CustomersSource } from '../customers/customers-source';
import { ApiConnection } from './api-connection';

@Injectable({ providedIn: 'root' })
export class RestCustomersSource extends CustomersSource {
  private readonly connection = inject(ApiConnection);
  list(): Observable<readonly Organization[]> {
    return this.connection
      .get<{ items: { customer_id: string; name: string }[] }>('/admin/customers')
      .pipe(
        map((result) =>
          result.items.map((customer) => ({ id: customer.customer_id, name: customer.name })),
        ),
      );
  }
  create(name: string): Observable<CreatedCustomer> {
    return this.connection
      .post<{ customer_id: string; name: string; api_key: string }>('/admin/customers', { name })
      .pipe(
        map((result) => ({
          customer: { id: result.customer_id, name: result.name },
          key: result.api_key,
        })),
      );
  }
}
