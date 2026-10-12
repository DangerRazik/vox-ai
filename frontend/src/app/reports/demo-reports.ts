import {
  BatchReportData,
  CRITERIA,
  CriterionId,
  CriterionScores,
  ReportCall,
} from './report-models';

const TEN_POINTS: CriterionScores = {
  '1.1': 1,
  '1.2': 0.5,
  '2.1': 1,
  '2.2': 1,
  '2.3': 0.5,
  '2.4': 1,
  '3.1': 1,
  '3.2': 1,
  '4.1': 1,
  '5.1': 1,
  '5.2': 1,
};
const CRITICAL_SCORES: CriterionScores = { ...TEN_POINTS, '1.2': 1, '2.3': 1, '5.2': 0 };

const RECORDING_DATES: Readonly<Record<string, string>> = {
  'batch-02': '2026-10-02T05:10:00Z',
  'batch-04': '2026-10-04T06:10:00Z',
  'support-06': '2026-10-06T06:10:00Z',
};
function metadata(batchId: string, index: number) {
  return {
    id: `${batchId}-call-${index}`,
    filename: `call_${String(index).padStart(3, '0')}.mp3`,
    employeeId: index % 2 === 0 ? null : `employee-${17 + (index % 6)}`,
    recordedAt: index === 1 ? (RECORDING_DATES[batchId] ?? null) : null,
  };
}
function success(
  batchId: string,
  index: number,
  scores: CriterionScores,
  zeroTotalOnCritical = true,
): ReportCall {
  const criticalViolation = scores['5.2'] === 0;
  return {
    ...metadata(batchId, index),
    outcome: 'success',
    scores,
    criticalViolation,
    total:
      criticalViolation && zeroTotalOnCritical
        ? 0
        : Object.values(scores).reduce<number>((sum, score) => sum + score, 0),
  };
}
function failure(batchId: string, index: number): ReportCall {
  return {
    ...metadata(batchId, index),
    outcome: 'error',
    stage: index % 2 ? 'transcription' : 'analysis',
    error:
      index % 2 ? 'Не удалось распознать речь в записи.' : 'Анализ не вернул корректный результат.',
  };
}

// Расчёт относится только к подготовке демо-набора. Рабочие сводки предоставляет backend.
function demoReport(
  calls: readonly ReportCall[],
  uploadErrors: number,
  enabled: readonly CriterionId[] = CRITERIA.map((c) => c.id),
): BatchReportData {
  const successful = calls.filter((call) => call.outcome === 'success');
  const count = successful.length;
  const criticalViolationCount = successful.filter((call) => call.criticalViolation).length;
  const criterionAverages = Object.fromEntries(
    enabled.map((id) => [
      id,
      count ? successful.reduce((sum, call) => sum + call.scores[id], 0) / count : null,
    ]),
  ) as Record<CriterionId, number | null>;
  return {
    calls,
    summary: {
      maxTotal: enabled.length,
      acceptedCalls: calls.length,
      successfulCalls: count,
      processingErrors: calls.length - count,
      uploadErrors,
      averageTotal: count ? successful.reduce((sum, call) => sum + call.total, 0) / count : null,
      criterionAverages,
      criticalViolationCount,
      criticalViolationRate: count ? criticalViolationCount / count : null,
    },
  };
}

const mixedCalls = Array.from({ length: 90 }, (_, offset) => {
  const index = offset + 1;
  if (index > 80) return failure('batch-04', index);
  if (index === 2 || index === 80) return success('batch-04', index, CRITICAL_SCORES);
  if (index === 1 || (index >= 66 && index <= 76))
    return success('batch-04', index, { ...TEN_POINTS, '5.1': 0.5 });
  if (index === 78 || index === 79) return success('batch-04', index, { ...TEN_POINTS, '5.1': 0 });
  return success('batch-04', index, TEN_POINTS);
});

// Явный условный исход ручного демо-шага: каждая принятая запись — 10 из 11.
// Он не зависит от ZIP или промптов и не выдаётся за результат реального анализа.
export function demoCompletedReport(
  batchId: string,
  acceptedCalls: number,
  uploadErrors: number,
  enabled: readonly CriterionId[] = CRITERIA.map((c) => c.id),
  zeroTotalOnCritical = true,
): BatchReportData {
  const scores = Object.fromEntries(enabled.map((id) => [id, TEN_POINTS[id]])) as CriterionScores;
  return demoReport(
    Array.from({ length: acceptedCalls }, (_, index) =>
      success(batchId, index + 1, scores, zeroTotalOnCritical),
    ),
    uploadErrors,
    enabled,
  );
}

export const DEMO_REPORTS: Readonly<Record<string, BatchReportData>> = {
  'batch-01': demoReport(
    [
      success('batch-01', 1, { ...TEN_POINTS, '1.2': 1, '2.3': 1 }),
      success('batch-01', 2, { ...TEN_POINTS, '1.2': 1, '2.3': 1 }),
    ],
    0,
  ),
  'batch-04': demoReport(mixedCalls, 10),
  'batch-02': demoReport(
    Array.from({ length: 12 }, (_, index) => failure('batch-02', index + 1)),
    3,
  ),
  'support-06': demoReport(
    Array.from({ length: 30 }, (_, index) =>
      success('support-06', index + 1, index === 1 ? CRITICAL_SCORES : TEN_POINTS, false),
    ),
    0,
  ),
};
