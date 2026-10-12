import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { StreamMetricSettings, PROCESSING_FIELDS } from './stream-processing';
import { CRITERIA } from '../reports/report-models';
import { CreateStreamRequest, StreamConfiguration } from './admin-streams-source';

export type StreamFormValue = Omit<CreateStreamRequest, 'organizationId'>;
type MaterialField = 'knowledgeBase' | 'unwantedExpressions' | 'textCorrections';

@Component({
  selector: 'app-stream-form',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stream-form.html',
})
export class StreamForm implements OnInit {
  readonly locked = input(false);
  readonly initialWhisperPrompt = input('');
  readonly initialConfiguration = input<StreamConfiguration | null>(null);
  readonly requestError = input('');
  readonly submitted = output<StreamFormValue>();
  protected readonly processingFields = PROCESSING_FIELDS;
  protected readonly processing = signal<StreamMetricSettings>({
    longPauseSec: 2,
    interruptionGapSec: 0.2,
  });
  protected readonly criteria = CRITERIA;
  protected readonly config = signal<StreamConfiguration>({
    name: '',
    enabledCriteria: CRITERIA.map((c) => c.id),
    whisperPrompt: '',
    llmPrompt: '',
    options: {
      tempoAnalysis: true,
      unwantedExpressions: true,
      textCorrections: true,
      zeroTotalOnCritical: true,
    },
  });
  protected readonly materials = signal<Record<MaterialField, File | null>>({
    knowledgeBase: null,
    unwantedExpressions: null,
    textCorrections: null,
  });
  protected readonly errors = signal<Readonly<Record<string, string>>>({});
  private readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  ngOnInit(): void {
    const initial = this.initialConfiguration();
    if (initial?.processing)
      this.processing.set({
        longPauseSec: initial.processing.longPauseSec,
        interruptionGapSec: initial.processing.interruptionGapSec,
      });
    this.config.update((config) => ({ ...config, whisperPrompt: this.initialWhisperPrompt() }));
    if (initial)
      this.config.set({
        name: initial.name,
        enabledCriteria: CRITERIA.map((c) => c.id),
        whisperPrompt: initial.whisperPrompt,
        llmPrompt: initial.llmPrompt,
        options: { ...initial.options },
      });
  }
  protected processingValue(field: keyof StreamMetricSettings, value: string): void {
    this.processing.update((p) => ({
      ...p,
      [field]: value.trim() ? Number(value) : NaN,
    }));
  }
  protected fields(stage: number) {
    return this.processingFields.filter((f) => f.stage === stage);
  }
  protected text(field: 'name' | 'whisperPrompt' | 'llmPrompt', value: string): void {
    this.config.update((config) => ({ ...config, [field]: value }));
  }
  protected option(field: keyof StreamConfiguration['options'], checked: boolean): void {
    this.config.update((config) => ({
      ...config,
      options: { ...config.options, [field]: checked },
    }));
    if (!checked) this.errors.update((errors) => ({ ...errors, [field]: '' }));
  }
  protected file(field: MaterialField, files: FileList | null): void {
    this.materials.update((materials) => ({ ...materials, [field]: files?.item(0) ?? null }));
  }
  protected submit(event: Event): void {
    event.preventDefault();
    if (this.locked()) return;
    const config = this.config();
    const materials = this.materials();
    const errors: Record<string, string> = {};
    if (!config.name.trim()) errors['name'] = 'Укажите название стрима.';
    if (!materials.knowledgeBase?.size)
      errors['knowledgeBase'] = 'Приложите непустой файл базы знаний.';
    if (config.options.unwantedExpressions && !materials.unwantedExpressions?.size)
      errors['unwantedExpressions'] =
        'Приложите непустой словарь нежелательных выражений или выключите опцию.';
    if (config.options.textCorrections && !materials.textCorrections?.size)
      errors['textCorrections'] =
        'Приложите непустой словарь корректировки текста или выключите опцию.';
    for (const field of this.processingFields) {
      const value = this.processing()[field.key];
      if (!Number.isFinite(value) || value < 0)
        errors[field.key] = 'Укажите неотрицательное число.';
    }
    this.errors.set(errors);
    if (Object.keys(errors).length) {
      // После отрисовки ошибок первый неверный элемент остаётся в том же DOM.
      const field = Object.keys(errors)[0];
      this.form().nativeElement.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }
    this.submitted.emit({
      ...config,
      enabledCriteria: CRITERIA.map((c) => c.id),
      options: { ...config.options },
      processing: { ...this.processing() },
      name: config.name.trim(),
      whisperPrompt: config.whisperPrompt.trim(),
      llmPrompt: config.llmPrompt.trim(),
      materials: {
        knowledgeBase: materials.knowledgeBase!,
        unwantedExpressions: config.options.unwantedExpressions
          ? materials.unwantedExpressions
          : null,
        textCorrections: config.options.textCorrections ? materials.textCorrections : null,
      },
    });
  }
}
