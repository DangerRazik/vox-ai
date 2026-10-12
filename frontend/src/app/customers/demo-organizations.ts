import { Injectable } from '@angular/core';
import { Organization } from '../batches/batch-models';

@Injectable({ providedIn: 'root' })
export class DemoOrganizations {
  private organizations: readonly Organization[] = [
    { id: 'contact-center', name: 'Контакт-центр' },
    { id: 'support', name: 'Сервис поддержки' },
  ];
  all(): readonly Organization[] {
    return this.organizations;
  }
  add(organization: Organization): void {
    this.organizations = [...this.organizations, organization];
  }
}
