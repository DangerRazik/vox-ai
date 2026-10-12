import { Batch, BatchStatus } from '../batches/batch-models';
import { formatNumber } from '../shared/formatting';
import { roleFromRest, SPEAKER_LABELS } from '../reports/speaker-roles';
import {
  BatchSummary,
  CriterionId,
  CriterionScores,
  CallAnalysis,
  ReportCall,
} from '../reports/report-models';

export interface BatchDto {
  max_total?: number;
  name?: string | null;
  archive_name?: string | null;
  batch_id: string;
  customer_id: string;
  stream_id: string;
  upload_id: string;
  created_at: string;
  status: BatchStatus;
  total_calls: number;
}
export interface StreamDto {
  stream_id: string;
  customer_id: string;
  name: string;
  options: { speech_rate_enabled: boolean; zero_total_on_critical: boolean };
}
export interface SummaryDto {
  max_total?: number;
  batch_id: string;
  stream_id: string;
  total_calls: number;
  successful_calls: number;
  processing_errors: number;
  upload_errors: number;
  average_total: number | null;
  criterion_averages: Record<CriterionId, number | null>;
  critical_violation_count: number;
  critical_violation_rate: number | null;
}
interface AnalysisDto {
  max_total?: number;
  scores: Record<CriterionId, { score: number; reason: string }>;
  total: number;
  critical_violation: boolean;
  critical_violation_details?: string;
  _segments?: { role: string; start: number; end: number; text: string }[];
  _metrics?: Record<string, unknown>;
  kb_check?: {
    questions_detected?: string[];
    operator_answers_correct?: boolean;
    mismatches?: { question: string; operator_said: string; kb_says: string }[];
  };
  recommendations?: string[];
}
export interface CallDto {
  call_id: string;
  batch_id: string;
  stream_id: string;
  original_name: string;
  external_employee_id: string | null;
  called_at: string | null;
  status: 'successful' | 'processing_error';
  result: AnalysisDto | null;
  error: string | null;
}

export function batchFromRest(dto: BatchDto, average: number | null = null): Batch {
  return {
    id: dto.batch_id,
    maxTotal: dto.max_total ?? 11,
    uploadId: dto.upload_id,
    organizationId: dto.customer_id,
    streamId: dto.stream_id,
    name: dto.name || `Загрузка ${dto.upload_id}`,
    filename: dto.archive_name || '',
    createdAt: dto.created_at,
    status: dto.status,
    acceptedCalls: dto.total_calls,
    averageTotal: average,
  };
}
export function summaryFromRest(dto: SummaryDto): BatchSummary {
  return {
    maxTotal: dto.max_total ?? 11,
    acceptedCalls: dto.total_calls,
    successfulCalls: dto.successful_calls,
    processingErrors: dto.processing_errors,
    uploadErrors: dto.upload_errors,
    averageTotal: dto.average_total,
    criterionAverages: dto.criterion_averages,
    criticalViolationCount: dto.critical_violation_count,
    criticalViolationRate: dto.critical_violation_rate,
  };
}
export function callFromRest(dto: CallDto): ReportCall {
  const metadata = {
    id: dto.call_id,
    filename: dto.original_name,
    employeeId: dto.external_employee_id,
    recordedAt: dto.called_at,
  };
  if (dto.status === 'processing_error')
    return {
      ...metadata,
      outcome: 'error',
      stage: 'unknown',
      error:
        dto.error === 'call_processing_failed'
          ? 'Не удалось обработать запись.'
          : (dto.error ?? 'Ошибка обработки записи.'),
    };
  if (!dto.result) throw new Error('missing-call-analysis');
  return {
    ...metadata,
    outcome: 'success',
    total: dto.result.total,
    scores: Object.fromEntries(
      Object.entries(dto.result.scores).map(([id, value]) => [id, value.score]),
    ) as CriterionScores,
    criticalViolation: dto.result.critical_violation,
  };
}
const metricNames: Record<string, { label: string; unit: string }> = {
  long_pauses_count: { label: 'Длительные паузы', unit: '' },
  interruptions_count: { label: 'Признаки перебивания', unit: '' },
  speech_rate_operator: { label: 'Темп речи сотрудника', unit: 'слов/с' },
  speech_rate_client: { label: 'Темп речи клиента', unit: 'слов/с' },
  uncertainty_markers: { label: 'Маркеры неуверенности', unit: '' },
  rudeness_markers: { label: 'Лексические маркеры грубости', unit: '' },
  total_duration_sec: { label: 'Длительность разговора', unit: 'с' },
};
export function analysisFromRest(dto: CallDto, stream: StreamDto): CallAnalysis | null {
  const result = dto.result;
  if (dto.status !== 'successful' || !result) return null;
  const call = callFromRest(dto);
  if (call.outcome !== 'success') return null;
  const knowledge = result.kb_check;
  return {
    assessment: {
      maxTotal: result.max_total ?? 11,
      total: result.total,
      scores: call.scores,
      explanations: Object.fromEntries(
        Object.entries(result.scores).map(([id, item]) => [
          id,
          {
            text: item.reason,
            applicable: !/не\s*применим/iu.test(item.reason),
          },
        ]),
      ) as CallAnalysis['assessment']['explanations'],
      zeroTotalOnCritical: stream.options.zero_total_on_critical,
      tempoAnalysisEnabled: stream.options.speech_rate_enabled,
      criticalReason: result.critical_violation_details || null,
    },
    transcript:
      result._segments?.map((segment) => ({
        ...segment,
        role: roleFromRest(segment.role),
      })) ?? null,
    metrics: result._metrics
      ? Object.entries(metricNames)
          .filter(([name]) => Object.hasOwn(result._metrics!, name))
          .map(([name, format]) => ({
            ...format,
            value:
              typeof result._metrics![name] === 'number'
                ? (result._metrics![name] as number)
                : null,
          }))
      : null,
    metricDetails: metricDetails(result._metrics),
    knowledgeCheck: knowledge
      ? {
          conclusion:
            knowledge.operator_answers_correct === true
              ? 'Ответы соответствуют базе знаний.'
              : knowledge.operator_answers_correct === false
                ? 'Обнаружены расхождения с базой знаний.'
                : 'Вывод о соответствии не указан.',
          references: [],
          questions: knowledge.questions_detected ?? [],
          mismatches:
            knowledge.mismatches?.map((item) => ({
              question: item.question,
              answer: item.operator_said,
              expected: item.kb_says,
            })) ?? [],
        }
      : null,
    recommendations: result.recommendations ?? null,
  };
}

function metricDetails(
  metrics: Record<string, unknown> | undefined,
): NonNullable<CallAnalysis['metricDetails']> {
  if (!metrics) return [];
  const formats: Record<
    string,
    { label: string; format: (item: Record<string, unknown>) => string }
  > = {
    unwanted_expressions: {
      label: 'Нежелательные выражения',
      format: (item) => `${item['expression']} — число вхождений: ${metricNumber(item['count'])}`,
    },
    long_pauses: {
      label: 'Длительные паузы: детали',
      format: (item) =>
        `На ${metricNumber(item['at'])} с: пауза ${metricNumber(item['sec'])} с между «${item['after']}» и «${item['before']}»`,
    },
    interruptions: {
      label: 'Признаки перебивания: детали',
      format: (item) =>
        `На ${metricNumber(item['at'])} с: ${SPEAKER_LABELS[roleFromRest(item['by'])]} — «${item['phrase']}»`,
    },
  };
  return Object.entries(formats).flatMap(([key, format]) => {
    const items = metrics[key];
    return Array.isArray(items) && items.length
      ? [{ label: format.label, items: items.map(format.format) }]
      : [];
  });
}

function metricNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : 'Нет данных';
}
