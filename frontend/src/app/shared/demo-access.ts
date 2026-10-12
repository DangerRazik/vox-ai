import { inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { DemoRole } from '../batches/batch-models';

const ROLE_STORAGE = 'vox-ai.demo-role';
@Injectable({ providedIn: 'root' })
export class DemoAccess {
  private readonly selectedRole = signal<DemoRole>(
    sessionStorage.getItem(ROLE_STORAGE) === 'team' ? 'team' : 'customer',
  );
  readonly role = this.selectedRole.asReadonly();
  open(role: DemoRole): void {
    this.selectedRole.set(role);
    sessionStorage.setItem(ROLE_STORAGE, role);
  }
  leave(): void {
    this.selectedRole.set('customer');
    sessionStorage.removeItem(ROLE_STORAGE);
  }
  requireTeam(): void {
    if (this.role() !== 'team') throw new Error('Доступ только для команды Vox AI');
  }
}
// Ограничение режима демо. Полномочия рабочего API проверяет сервер по ключу.
export const teamDemoOnly: CanActivateFn = () =>
  inject(DemoAccess).role() === 'team' || inject(Router).createUrlTree(['/demo/access-denied']);
