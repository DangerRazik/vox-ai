import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DemoUploadsSource, RecoveryScenario } from './demo-uploads-source';

@Component({
  selector: 'app-demo-recovery-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="demo-controls">
      <summary>Демо-сценарии восстановления</summary>
      <fieldset class="upload-fields" [disabled]="locked()">
        <legend class="sr-only">Условный результат проверки состава</legend>
        @if (initialImport()) {
          <label for="retry-import-scenario">Результат повтора импорта</label>
          <select
            id="retry-import-scenario"
            #importScenario
            (change)="setImportScenario(importScenario.value)"
          >
            <option value="success" [selected]="source.retryImportScenario === 'success'">
              Исправленный ZIP принят
            </option>
            <option value="failure" [selected]="source.retryImportScenario === 'failure'">
              Ошибка распаковки ZIP
            </option>
          </select>
        } @else {
          <label for="recovery-scenario">Состав повторной загрузки</label>
          <select id="recovery-scenario" #scenario (change)="setScenario(scenario.value)">
            <option value="complete" [selected]="source.recoveryScenario === 'complete'">
              Полный исходный набор
            </option>
            <option value="incomplete" [selected]="source.recoveryScenario === 'incomplete'">
              Не хватает одной записи
            </option>
            <option value="changed" [selected]="source.recoveryScenario === 'changed'">
              Одна запись заменена другой
            </option>
          </select>
          <label class="checkbox-field"
            ><input
              type="checkbox"
              #interrupted
              [checked]="source.interruptRecovery"
              (change)="source.interruptRecovery = interrupted.checked"
            />Прервать передачу после частичного приёма</label
          >
        }
      </fieldset>
    </details>
  `,
})
export class DemoRecoveryControls {
  readonly locked = input(false);
  readonly initialImport = input(false);
  protected readonly source = inject(DemoUploadsSource);
  protected setScenario(value: string) {
    this.source.recoveryScenario = value as RecoveryScenario;
  }
  protected setImportScenario(value: string) {
    this.source.retryImportScenario = value as 'success' | 'failure';
  }
}
