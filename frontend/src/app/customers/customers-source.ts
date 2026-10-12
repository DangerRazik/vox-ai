import { Observable } from 'rxjs';
import { Organization } from '../batches/batch-models';

export interface CreatedCustomer {
  readonly customer: Organization;
  readonly key: string;
}
export abstract class CustomersSource {
  abstract list(): Observable<readonly Organization[]>;
  abstract create(name: string): Observable<CreatedCustomer>;
}
