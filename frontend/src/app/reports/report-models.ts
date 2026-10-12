import { Batch, Organization, Stream } from '../batches/batch-models';

export const CRITERIA = [
  { id: '1.1', name: 'Приветствие' },
  { id: '1.2', name: 'Прощание' },
  { id: '2.1', name: 'Наличие слов вежливости' },
  { id: '2.2', name: 'Темп разговора' },
  { id: '2.3', name: 'Тон разговора' },
  { id: '2.4', name: 'Грамотность и культура речи' },
  { id: '3.1', name: 'Активная позиция и демонстрация внимания' },
  { id: '3.2', name: 'Работа с конфликтом' },
  { id: '4.1', name: 'Постановка/снятие удержания' },
  { id: '5.1', name: 'Соблюдение скрипта и регламента' },
  { id: '5.2', name: 'Критическое нарушение' },
] as const;

export type CriterionId = (typeof CRITERIA)[number]['id'];
export type CriterionScores = Readonly<Record<Exclude<CriterionId, '5.2'>, 0 | 0.5 | 1>> & {
  readonly '5.2': 0 | 1;
};
interface CallMetadata {
  readonly id: string;
  readonly filename: string;
  readonly employeeId: string | null;
  readonly recordedAt: string | null;
}
export type ReportCall = CallMetadata &
  (
    | {
        readonly outcome: 'success';
        readonly total: number;
        readonly scores: CriterionScores;
        readonly criticalViolation: boolean;
      }
    | {
        readonly outcome: 'error';
        readonly stage: 'transcription' | 'processing' | 'analysis' | 'unknown';
        readonly error: string;
      }
  );
export interface BatchSummary {
  readonly maxTotal?: number;
  readonly acceptedCalls: number;
  readonly successfulCalls: number;
  readonly processingErrors: number;
  readonly uploadErrors: number;
  readonly averageTotal: number | null;
  readonly criterionAverages: Readonly<Record<CriterionId, number | null>>;
  readonly criticalViolationCount: number;
  readonly criticalViolationRate: number | null;
}
export interface BatchReportData {
  readonly summary: BatchSummary;
  readonly calls: readonly ReportCall[];
}
export interface BatchReport extends BatchReportData {
  readonly batch: Batch;
  readonly organization: Organization;
  readonly stream: Stream;
}
export type BatchReportResult =
  | { readonly kind: 'available'; readonly report: BatchReport }
  | { readonly kind: 'unavailable'; readonly batch: Batch; readonly organization: Organization }
  | { readonly kind: 'not-found' };

export interface CriterionExplanation {
  readonly text: string | null;
  readonly applicable: boolean;
}
export interface CallAssessment {
  readonly maxTotal?: number;
  readonly scores: CriterionScores;
  readonly total: number;
  readonly explanations: Readonly<Record<CriterionId, CriterionExplanation>>;
  readonly zeroTotalOnCritical: boolean;
  readonly tempoAnalysisEnabled: boolean;
  readonly criticalReason: string | null;
}
export interface TranscriptSegment {
  readonly role: 'employee' | 'customer' | 'unknown';
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
export interface CallAnalysis {
  readonly assessment: CallAssessment;
  readonly transcript: readonly TranscriptSegment[] | null;
  readonly metrics:
    | readonly { readonly label: string; readonly value: number | null; readonly unit: string }[]
    | null;
  readonly knowledgeCheck: {
    readonly conclusion: string;
    readonly references: readonly string[];
    readonly questions?: readonly string[];
    readonly mismatches?: readonly {
      readonly question: string;
      readonly answer: string;
      readonly expected: string;
    }[];
  } | null;
  readonly recommendations: readonly string[] | null;
  readonly metricDetails?: readonly { readonly label: string; readonly items: readonly string[] }[];
}
export interface CallReport {
  readonly batch: Batch;
  readonly organization: Organization;
  readonly stream: Stream;
  readonly call: ReportCall;
  readonly analysis: CallAnalysis | null;
}
export type CallReportResult =
  | { readonly kind: 'available'; readonly report: CallReport }
  | { readonly kind: 'unavailable'; readonly batch: Batch; readonly organization: Organization }
  | { readonly kind: 'not-found' };
