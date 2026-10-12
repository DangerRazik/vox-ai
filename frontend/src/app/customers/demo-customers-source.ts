import { createUuid } from '../shared/uuid';
import { inject, Injectable } from '@angular/core';
import { defer, map, Observable, timer } from 'rxjs';
import { Organization } from '../batches/batch-models';
import { CreatedCustomer, CustomersSource } from './customers-source';
import { DemoOrganizations } from './demo-organizations';
import { DemoAccess } from '../shared/demo-access';

@Injectable({ providedIn: 'root' })
export class DemoCustomersSource extends CustomersSource {
  private readonly organizations = inject(DemoOrganizations);
  private readonly access = inject(DemoAccess);
  private failNextCreate = false;
  private failNextList = false;
  simulateNextListError(): void {
    this.failNextList = true;
  }
  simulateNextCreateError(): void {
    this.failNextCreate = true;
  }
  override list(): Observable<readonly Organization[]> {
    return defer(() => {
      const fail = this.failNextList;
      this.failNextList = false;
      return timer(350).pipe(
        map(() => {
          this.access.requireTeam();
          if (fail) throw new Error('Демонстрационная ошибка списка заказчиков');
          return this.organizations.all();
        }),
      );
    });
  }
  override create(name: string): Observable<CreatedCustomer> {
    return defer(() => {
      const fail = this.failNextCreate;
      this.failNextCreate = false;
      return timer(500).pipe(
        map(() => {
          this.access.requireTeam();
          if (fail) throw new Error('Демонстрационная ошибка создания заказчика');
          if (!name.trim()) throw new Error('Укажите название заказчика');
          const customer = { id: createUuid(), name: name.trim() };
          this.organizations.add(customer);
          return { customer, key: `demo-only-${createUuid()}` };
        }),
      );
    });
  }
}
