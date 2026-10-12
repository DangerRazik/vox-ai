import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DemoUploadsSource, IntakeScenario } from './demo-uploads-source';

@Component({
  selector: 'app-demo-intake-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="demo-controls">
      <summary>Демо-сценарии приёма</summary>
      <fieldset class="upload-fields" [disabled]="locked()">
        <legend class="sr-only">Настройки имитации</legend>
        <label for="intake-scenario">Результат имитации</label>
        <select id="intake-scenario" #scenario (change)="setScenario(scenario.value)">
          <option value="partial" [selected]="source.scenario === 'partial'">
            Частичный приём
          </option>
          <option value="success" [selected]="source.scenario === 'success'">
            Все записи приняты
          </option>
          <option value="empty" [selected]="source.scenario === 'empty'">
            Ни одной записи не принято
          </option>
        </select>
        <label class="checkbox-field"
          ><input
            type="checkbox"
            #lost
            [checked]="source.loseConfirmation"
            (change)="source.loseConfirmation = lost.checked"
          />Потерять подтверждение после приёма</label
        >
      </fieldset>
    </details>
  `,
})
export class DemoIntakeControls {
  readonly locked = input(false);
  protected readonly source = inject(DemoUploadsSource);
  protected setScenario(value: string) {
    this.source.scenario = value as IntakeScenario;
  }
}
