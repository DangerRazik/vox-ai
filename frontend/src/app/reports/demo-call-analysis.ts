import {
  CallAnalysis,
  CRITERIA,
  CriterionExplanation,
  CriterionId,
  ReportCall,
  TranscriptSegment,
} from './report-models';

const TRANSCRIPT: readonly TranscriptSegment[] = [
  {
    role: 'employee',
    start: 0,
    end: 8,
    text: 'Добрый день! Контакт-центр, меня зовут Анна. Чем могу помочь?',
  },
  { role: 'customer', start: 8, end: 15, text: 'Хочу уточнить, как оформить обращение.' },
  {
    role: 'employee',
    start: 15,
    end: 36,
    text: 'Обращение можно оформить через личный кабинет. Откройте раздел «Обращения», опишите вопрос и отправьте форму.',
  },
  { role: 'customer', start: 36, end: 44, text: 'Спасибо, теперь порядок понятен.' },
  { role: 'employee', start: 44, end: 50, text: 'Рада помочь. Всего доброго!' },
];

export function demoCallAnalysis(
  call: ReportCall,
  options: { readonly zeroTotalOnCritical: boolean; readonly tempoAnalysis: boolean },
): CallAnalysis | null {
  if (call.outcome === 'error') return null;
  const explanations = Object.fromEntries(
    CRITERIA.map(({ id }) => [
      id,
      {
        text:
          call.scores[id] === 1
            ? 'Критерий выполнен в демонстрационном разговоре.'
            : call.scores[id] === 0.5
              ? 'Критерий выполнен частично; требуется улучшение.'
              : 'Критерий не выполнен.',
        applicable: id !== '4.1',
      },
    ]),
  ) as Record<CriterionId, CriterionExplanation>;
  explanations['1.1'] = {
    text: 'Сотрудник поприветствовал клиента и представился.',
    applicable: true,
  };
  explanations['1.2'] = {
    text:
      call.scores['1.2'] === 1
        ? 'Сотрудник завершил разговор прощанием.'
        : 'Сотрудник попрощался, но не уточнил, остались ли вопросы.',
    applicable: true,
  };
  explanations['4.1'] = { text: 'Удержание в разговоре не использовалось.', applicable: false };
  const critical = call.scores['5.2'] === 0;
  const criticalReason = critical
    ? 'Сотрудник использовал оскорбительное выражение в адрес клиента.'
    : null;
  explanations['5.2'] = {
    text: criticalReason ?? 'Критических нарушений не выявлено.',
    applicable: true,
  };
  const transcript = critical
    ? [
        ...TRANSCRIPT.slice(0, 2),
        {
          role: 'employee' as const,
          start: 15,
          end: 36,
          text: 'Сотрудник использует оскорбительное выражение в адрес клиента (демонстрационный пример нарушения).',
        },
        ...TRANSCRIPT.slice(3),
      ]
    : TRANSCRIPT;
  const withoutOptionalData = call.id === 'batch-04-call-3';
  const longTranscript: readonly TranscriptSegment[] = [
    ...TRANSCRIPT,
    {
      role: 'customer',
      start: 50,
      end: 650,
      text:
        'Уточню детали обращения: при заполнении формы я указал контактные данные и описание вопроса. Мне важно понять порядок дальнейших действий и сроки ответа. '.repeat(
          60,
        ) +
        ' Номер обращения: ' +
        '0123456789'.repeat(30),
    },
  ];
  return {
    assessment: {
      maxTotal: Object.keys(call.scores).length,
      scores: call.scores,
      total: call.total,
      explanations,
      zeroTotalOnCritical: options.zeroTotalOnCritical,
      tempoAnalysisEnabled: options.tempoAnalysis,
      criticalReason,
    },
    transcript: withoutOptionalData ? longTranscript : transcript,
    metrics: withoutOptionalData
      ? null
      : !options.tempoAnalysis
        ? [{ label: 'Длительность разговора', value: 50, unit: 'с' }]
        : [
            { label: 'Темп сотрудника', value: 120, unit: 'слов/мин' },
            { label: 'Длительность разговора', value: 50, unit: 'с' },
          ],
    knowledgeCheck: withoutOptionalData
      ? null
      : {
          conclusion: critical
            ? 'Соответствие инструкции не подтверждено: сотрудник не объяснил порядок оформления.'
            : 'Инструкция соответствует материалам базы знаний.',
          references: ['Порядок оформления обращения'],
        },
    recommendations: withoutOptionalData
      ? null
      : [
          'Перед завершением разговора уточнять, остались ли вопросы у клиента.',
          'Сохранять спокойный и уважительный тон разговора.',
        ],
  };
}
