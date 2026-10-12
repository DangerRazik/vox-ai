export interface StreamProcessing {
  whisperModel: string;
  llmModel: string;
  speechLang: string;
  rolePrompt: string;
  analysisSystemPrompt: string;
  analysisUserPrompt: string;
  longPauseSec: number;
  interruptionGapSec: number;
}
export type StreamMetricSettings = Pick<StreamProcessing, 'longPauseSec' | 'interruptionGapSec'>;
export const PROCESSING_FIELDS: readonly {
  key: keyof StreamMetricSettings;
  label: string;
  type: 'number';
  stage: number;
}[] = [
  { key: 'longPauseSec', label: 'Порог длительной паузы, с', type: 'number', stage: 2 },
  { key: 'interruptionGapSec', label: 'Порог перебивания, с', type: 'number', stage: 2 },
];
