import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap, throwError } from 'rxjs';
import {
  AdminStream,
  AdminStreamsSource,
  CreateStreamRequest,
  DeleteStreamResult,
  MaterialMetadata,
} from '../streams/admin-streams-source';
import { CriterionId } from '../reports/report-models';
import { ApiConnection } from './api-connection';

interface SnapshotDto {
  stream_id: string;
  customer_id: string;
  name: string;
  created_at: string;
  criteria: { id: CriterionId; title: string }[];
  config: {
    enabled_criteria?: CriterionId[];
    whisper_prompt: string;
    role_prompt: string;
    analysis_system_prompt: string;
    analysis_user_prompt: string;
    whisper_model: string;
    llm_model: string;
    speech_lang: string;
    long_pause_sec: number;
    interruption_gap_sec: number;
    speech_rate_enabled: boolean;
    unwanted_expressions_enabled: boolean;
    text_correction_enabled: boolean;
    zero_total_on_critical: boolean;
  };
  materials: Record<string, { size_bytes: number; sha256: string }>;
}
function streamFromRest(dto: SnapshotDto): AdminStream {
  const c = dto.config;
  const material = (key: string, name: string): MaterialMetadata | null =>
    dto.materials[key]
      ? { name, size: dto.materials[key].size_bytes, type: '', sha256: dto.materials[key].sha256 }
      : null;
  const knowledgeBase = material('knowledge_base', 'База знаний');
  if (!knowledgeBase) throw new Error('missing-knowledge-base');
  return {
    id: dto.stream_id,
    organizationId: dto.customer_id,
    name: dto.name,
    createdAt: dto.created_at,
    criteria: dto.criteria.map((item) => ({ id: item.id, name: item.title })),
    enabledCriteria: dto.criteria.map((item) => item.id),
    options: {
      tempoAnalysis: c.speech_rate_enabled,
      unwantedExpressions: c.unwanted_expressions_enabled,
      textCorrections: c.text_correction_enabled,
      zeroTotalOnCritical: c.zero_total_on_critical,
    },
    whisperPrompt: c.whisper_prompt,
    llmPrompt: c.analysis_system_prompt,
    processing: {
      whisperModel: c.whisper_model,
      llmModel: c.llm_model,
      speechLang: c.speech_lang,
      rolePrompt: c.role_prompt,
      analysisSystemPrompt: c.analysis_system_prompt,
      analysisUserPrompt: c.analysis_user_prompt,
      longPauseSec: c.long_pause_sec,
      interruptionGapSec: c.interruption_gap_sec,
    },
    materials: {
      knowledgeBase,
      unwantedExpressions: material('unwanted_expressions', 'Словарь нежелательных выражений'),
      textCorrections: material('text_corrections', 'Словарь корректировки'),
    },
  };
}
@Injectable({ providedIn: 'root' })
export class RestAdminStreamsSource extends AdminStreamsSource {
  private readonly connection = inject(ApiConnection);
  creationDefaults() {
    return this.connection
      .get<{ whisper_prompt: string }>('/admin/stream-defaults')
      .pipe(map((dto) => ({ whisperPrompt: dto.whisper_prompt })));
  }
  list(organizationId: string): Observable<readonly AdminStream[]> {
    return this.connection
      .get<{ items: { stream_id: string }[] }>(
        '/streams',
        new HttpParams().set('customer_id', organizationId),
      )
      .pipe(
        switchMap((result) =>
          result.items.length
            ? forkJoin(result.items.map((s) => this.details(organizationId, s.stream_id)))
            : of([]),
        ),
        map((streams) => streams.filter((s): s is AdminStream => s !== null)),
      );
  }
  details(organizationId: string, streamId: string): Observable<AdminStream | null> {
    return this.connection.get<SnapshotDto>(`/admin/streams/${encodeURIComponent(streamId)}`).pipe(
      map((dto) => (dto.customer_id === organizationId ? streamFromRest(dto) : null)),
      catchError((error) =>
        error instanceof HttpErrorResponse && error.status === 404
          ? of(null)
          : throwError(() => error),
      ),
    );
  }
  create(request: CreateStreamRequest): Observable<AdminStream> {
    const p = request.processing;
    if (!p) return throwError(() => new Error('missing-processing-config'));
    const config = {
      name: request.name,
      ...(request.enabledCriteria ? { enabled_criteria: request.enabledCriteria } : {}),
      whisper_prompt: request.whisperPrompt,
      long_pause_sec: p.longPauseSec,
      interruption_gap_sec: p.interruptionGapSec,
      speech_rate_enabled: request.options.tempoAnalysis,
      unwanted_expressions_enabled: request.options.unwantedExpressions,
      text_correction_enabled: request.options.textCorrections,
      zero_total_on_critical: request.options.zeroTotalOnCritical,
    };
    const body = new FormData();
    body.append('config', JSON.stringify(config));
    body.append('knowledge_base', request.materials.knowledgeBase);
    if (request.materials.unwantedExpressions)
      body.append('unwanted_expressions', request.materials.unwantedExpressions);
    if (request.materials.textCorrections)
      body.append('text_corrections', request.materials.textCorrections);
    return this.connection
      .post<SnapshotDto>(
        `/admin/customers/${encodeURIComponent(request.organizationId)}/streams`,
        body,
      )
      .pipe(map(streamFromRest));
  }
  delete(_organizationId: string, streamId: string): Observable<DeleteStreamResult> {
    return this.connection.delete<void>(`/admin/streams/${encodeURIComponent(streamId)}`).pipe(
      map(() => ({ kind: 'deleted' as const })),
      catchError((error) =>
        error instanceof HttpErrorResponse && error.status === 409
          ? of<DeleteStreamResult>({
              kind: 'busy',
              message:
                'Стрим занят загрузкой, восстановлением или обработкой. Повторите удаление после завершения операции.',
            })
          : error instanceof HttpErrorResponse && error.status === 404
            ? of<DeleteStreamResult>({ kind: 'not-found' })
            : throwError(() => error),
      ),
    );
  }
}
