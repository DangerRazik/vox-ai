import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiConnection, connectionError, connectionErrorField } from './api-connection';

@Component({
  selector: 'app-connection-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="entry connection-entry">
      <a class="entry-brand" routerLink="/" aria-label="Vox AI — главная">vox<span> ai</span></a>
      <h1>Подключение к Vox AI</h1>
      <p class="entry-description">
        Введите ключ, полученный от команды Vox AI. Раздел и организация определяются вашим ключом.
      </p>
      <form class="upload-panel" (submit)="$event.preventDefault(); submit()">
        <fieldset class="upload-fields" [disabled]="busy()">
          <label class="field" for="api-key"
            >API-ключ
            <input
              id="api-key"
              name="key"
              type="password"
              [value]="key()"
              (input)="key.set($any($event.target).value)"
              required
              autocomplete="off"
              spellcheck="false"
              [attr.aria-invalid]="keyError() ? 'true' : null"
              [attr.aria-describedby]="keyError() ? 'key-error' : null"
            />
          </label>
          @if (keyError()) {
            <p id="key-error" role="alert" class="field-error">{{ keyError() }}</p>
          }
          <p class="muted">Ключ сохранится в этом браузере до выхода.</p>
          <button class="button primary" type="submit">
            {{ busy() ? 'Подключаемся…' : 'Подключиться' }}
          </button>
        </fieldset>
        @if (error() || (connection.notice() && !keyError())) {
          <p role="alert" class="field-error">{{ error() || connection.notice() }}</p>
        }
        @if (canRestore()) {
          <button class="button secondary" type="button" [disabled]="busy()" (click)="retry()">
            Повторить сохранённое подключение
          </button>
        }
      </form>
      <a routerLink="/">Открыть демонстрацию</a>
    </main>
  `,
})
export class ConnectionPage {
  protected readonly connection = inject(ApiConnection);
  private readonly router = inject(Router);
  protected readonly key = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly keyError = signal('');
  protected readonly canRestore = signal(false);

  constructor() {
    void this.retry(true);
  }

  protected async retry(initial = false): Promise<void> {
    // An absent saved key is normal on the first visit.
    if (initial && !this.connection.hasSaved) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const access = await this.connection.restore();
      await this.router.navigate(['/', access.role, 'batches']);
    } catch (error) {
      this.error.set(connectionError(error));
      this.canRestore.set(this.connection.hasSaved);
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.keyError.set('');
    this.error.set('');
    if (!this.key().trim()) {
      this.keyError.set('Укажите API-ключ.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.canRestore.set(false);
    try {
      const access = await this.connection.connect(this.key());
      this.key.set('');
      await this.router.navigate(['/', access.role, 'batches']);
    } catch (error) {
      const field = connectionErrorField(error);
      const message = connectionError(error);
      if (field === 'key') this.keyError.set(message);
      else this.error.set(message);
    } finally {
      this.busy.set(false);
    }
  }
}
