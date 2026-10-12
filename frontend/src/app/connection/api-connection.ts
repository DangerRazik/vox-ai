import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import {
  Observable,
  Subject,
  catchError,
  defer,
  firstValueFrom,
  map,
  takeUntil,
  throwError,
  timeout,
} from 'rxjs';
import { Organization } from '../batches/batch-models';

type AccessContext =
  | { role: 'customer'; customer: { customer_id: string; name: string } }
  | { role: 'admin'; customer: null };
interface Credentials {
  address: string;
  key: string;
}
export interface Access {
  role: 'customer' | 'team';
  organization: Organization | null;
}
const STORAGE_KEY = 'vox-api-connection';
// Deployment routes this same-origin path to the backend.
const API_ADDRESS = new URL('api/v1', document.baseURI).pathname.replace(/\/+$/, '');

export function connectionError(error: unknown): string {
  if (error instanceof Error && error.message === 'invalid-key')
    return 'Укажите API-ключ без пробелов внутри.';
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return 'Ключ отклонён. Проверьте ключ и подключитесь снова.';
  }
  if (error instanceof HttpErrorResponse && error.status === 403) {
    return 'Недостаточно прав для этого действия.';
  }
  return 'Не удалось связаться с Vox AI. Повторите запрос.';
}

export function connectionErrorField(error: unknown): 'key' | null {
  if (
    (error instanceof Error && error.message === 'invalid-key') ||
    (error instanceof HttpErrorResponse && error.status === 401)
  )
    return 'key';
  return null;
}

function normalizeAddress(value: string): string {
  const address = value.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(address, window.location.origin);
  } catch {
    throw new Error('invalid-address');
  }
  if (
    !address ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (address.startsWith('/') && address.startsWith('//'))
  ) {
    throw new Error('invalid-address');
  }
  return address.startsWith('/') ? url.pathname.replace(/\/+$/, '') : url.href.replace(/\/+$/, '');
}

@Injectable({ providedIn: 'root' })
export class ApiConnection {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly changed = new Subject<void>();
  private credentials: Credentials | null = this.readSaved();
  private generation = 0;
  private pending: Promise<Access> | null = null;
  readonly access = signal<Access | null>(null);
  readonly notice = signal('');
  get address(): string {
    return API_ADDRESS;
  }
  get hasSaved(): boolean {
    return this.credentials !== null;
  }

  async connect(key: string): Promise<Access> {
    this.clear();
    if (!key.trim() || /\s/.test(key.trim())) throw new Error('invalid-key');
    this.credentials = { address: API_ADDRESS, key: key.trim() };
    const generation = this.generation;
    try {
      const access = await this.restore();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.credentials));
      return access;
    } catch (error) {
      if (generation === this.generation) this.clear();
      throw error;
    }
  }

  restore(): Promise<Access> {
    const access = this.access();
    if (access) return Promise.resolve(access);
    if (this.pending) return this.pending;
    if (!this.credentials) return Promise.reject(new Error('no-connection'));
    const generation = this.generation;
    const pending = firstValueFrom(this.get<AccessContext>('/access-context'))
      .then((context) => {
        if (generation !== this.generation) throw new Error('connection-changed');
        if (
          context.role !== 'admin' &&
          (context.role !== 'customer' ||
            !context.customer?.customer_id ||
            typeof context.customer.name !== 'string')
        )
          throw new Error('invalid-context');
        const access: Access =
          context.role === 'admin'
            ? { role: 'team', organization: null }
            : {
                role: 'customer',
                organization: { id: context.customer.customer_id, name: context.customer.name },
              };
        this.access.set(access);
        this.notice.set('');
        return access;
      })
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }

  get<T>(path: string, params?: HttpParams): Observable<T> {
    return this.request<T>('GET', path, undefined, params).pipe(
      map((response) => response.body as T),
    );
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.postResponse<T>(path, body).pipe(map((response) => response.body as T));
  }

  delete<T>(path: string): Observable<T> {
    return this.request<T>('DELETE', path).pipe(map((response) => response.body as T));
  }

  postResponse<T>(path: string, body: unknown): Observable<HttpResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  private request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    params?: HttpParams,
  ): Observable<HttpResponse<T>> {
    return defer(() => {
      const credentials = this.credentials;
      if (!credentials) return throwError(() => new Error('no-connection'));
      return this.http
        .request<T>(method, `${credentials.address}${path}`, {
          body,
          params,
          observe: 'response',
          headers: { Authorization: `Bearer ${credentials.key}` },
        })
        .pipe(
          // ZIP intake can legitimately take longer than ordinary API requests.
          body instanceof FormData
            ? (source: Observable<HttpResponse<T>>) => source
            : timeout(20_000),
          takeUntil(this.changed),
          catchError((error) => {
            if (error instanceof HttpErrorResponse && error.status === 401) {
              this.clear();
              this.notice.set(connectionError(error));
              void this.router.navigate(['/connect']);
            }
            return throwError(() => error);
          }),
        );
    });
  }

  clear(): void {
    this.generation++;
    this.changed.next();
    this.pending = null;
    this.credentials = null;
    this.access.set(null);
    this.notice.set('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Storage may be disabled. */
    }
  }

  private readSaved(): Credentials | null {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Credentials | null;
      if (
        saved &&
        typeof saved.address === 'string' &&
        typeof saved.key === 'string' &&
        saved.key.trim() &&
        !/\s/.test(saved.key)
      ) {
        const savedUrl = new URL(normalizeAddress(saved.address), window.location.origin);
        const configuredUrl = new URL(API_ADDRESS, window.location.origin);
        if (savedUrl.href !== configuredUrl.href) return null;
        return { address: API_ADDRESS, key: saved.key };
      }
    } catch {
      /* Malformed or unavailable storage requires a new connection. */
    }
    return null;
  }
}

export const connectedOnly: CanActivateFn = async (route) => {
  const connection = inject(ApiConnection);
  const router = inject(Router);
  try {
    const access = await connection.restore();
    return (
      access.role === route.data['role'] || router.createUrlTree(['/', access.role, 'batches'])
    );
  } catch (error) {
    connection.notice.set(connectionError(error));
    return router.createUrlTree(['/connect']);
  }
};
