import { createUuid } from '../shared/uuid';
import { inject, Injectable } from '@angular/core';
import { defer, map, Observable, of, timer } from 'rxjs';
import { DemoAccess } from '../shared/demo-access';
import { DemoOrganizations } from '../customers/demo-organizations';
import { CRITERIA } from '../reports/report-models';
import { DemoBatchesSource } from '../batches/demo-batches-source';
import { DemoUploadsSource } from '../uploads/demo-uploads-source';
import {
  AdminStream,
  AdminStreamsSource,
  CreateStreamRequest,
  DeleteStreamResult,
  MaterialMetadata,
} from './admin-streams-source';
import { DemoStreamCatalog, DEMO_WHISPER_PROMPT } from './demo-stream-catalog';

@Injectable({ providedIn: 'root' })
export class DemoAdminStreamsSource extends AdminStreamsSource {
  private readonly catalog = inject(DemoStreamCatalog);
  private readonly organizations = inject(DemoOrganizations);
  private readonly access = inject(DemoAccess);
  private readonly batches = inject(DemoBatchesSource);
  private readonly uploads = inject(DemoUploadsSource);
  private failNextCreate = false;
  private failNextRead = false;
  private failNextDelete = false;
  simulateNextDeleteError(): void {
    this.failNextDelete = true;
  }
  simulateNextCreateError(): void {
    this.failNextCreate = true;
  }
  simulateNextReadError(): void {
    this.failNextRead = true;
  }
  private requireOrganization(id: string): void {
    this.access.requireTeam();
    if (!this.organizations.all().some((org) => org.id === id))
      throw new Error('Заказчик недоступен');
  }
  override creationDefaults() {
    return of({ whisperPrompt: DEMO_WHISPER_PROMPT });
  }
  override list(organizationId: string): Observable<readonly AdminStream[]> {
    return defer(() => {
      const fail = this.failNextRead;
      this.failNextRead = false;
      return timer(350).pipe(
        map(() => {
          this.requireOrganization(organizationId);
          if (fail) throw new Error('Демонстрационная ошибка чтения стримов');
          return this.catalog.all().filter((stream) => stream.organizationId === organizationId);
        }),
      );
    });
  }
  override details(organizationId: string, streamId: string): Observable<AdminStream | null> {
    return this.list(organizationId).pipe(
      map((streams) => streams.find((stream) => stream.id === streamId) ?? null),
    );
  }
  override create(request: CreateStreamRequest): Observable<AdminStream> {
    return defer(() => {
      const fail = this.failNextCreate;
      this.failNextCreate = false;
      return timer(500).pipe(
        map(() => {
          this.requireOrganization(request.organizationId);
          if (fail) throw new Error('Демонстрационная ошибка создания до изменения каталога');
          const { materials, options } = request;
          const criteria = CRITERIA.filter(
            (c) => !request.enabledCriteria || request.enabledCriteria.includes(c.id),
          );
          if (!criteria.length) throw new Error('Выберите хотя бы один критерий');
          if (!request.name.trim() || !request.whisperPrompt.trim())
            throw new Error('Заполните имя и промпт Whisper');
          if (
            !materials.knowledgeBase?.size ||
            (options.unwantedExpressions && !materials.unwantedExpressions?.size) ||
            (options.textCorrections && !materials.textCorrections?.size)
          )
            throw new Error('Приложите требуемые материалы');
          const metadata = (file: File): MaterialMetadata => ({
            name: file.name,
            size: file.size,
            type: file.type,
          });
          const stream: AdminStream = {
            id: createUuid(),
            organizationId: request.organizationId,
            name: request.name.trim(),
            createdAt: new Date().toISOString(),
            whisperPrompt: request.whisperPrompt.trim(),
            llmPrompt: request.llmPrompt.trim(),
            options: {
              ...options,
              zeroTotalOnCritical:
                criteria.some((c) => c.id === '5.2') && options.zeroTotalOnCritical,
            },
            enabledCriteria: criteria.map((c) => c.id),
            criteria,
            materials: {
              knowledgeBase: metadata(materials.knowledgeBase),
              unwantedExpressions: options.unwantedExpressions
                ? metadata(materials.unwantedExpressions!)
                : null,
              textCorrections: options.textCorrections
                ? metadata(materials.textCorrections!)
                : null,
            },
          };
          this.catalog.add(stream);
          return stream;
        }),
      );
    });
  }
  override delete(organizationId: string, streamId: string): Observable<DeleteStreamResult> {
    return defer(() => {
      const fail = this.failNextDelete;
      this.failNextDelete = false;
      return timer(500).pipe(
        map(() => {
          this.requireOrganization(organizationId);
          if (fail) throw new Error('Демонстрационная ошибка удаления до изменения данных');
          const stream = this.catalog
            .all()
            .find((item) => item.id === streamId && item.organizationId === organizationId);
          if (!stream) return { kind: 'not-found' } as const;
          if (this.batches.hasActiveWork(streamId))
            return {
              kind: 'busy',
              message:
                'Удаление запрещено: идёт активный импорт или обработка этого стрима. Дождитесь завершения и повторите попытку.',
            } as const;
          this.uploads.forgetStream(streamId);
          this.batches.removeStreamData(streamId);
          this.catalog.remove(streamId);
          return { kind: 'deleted' } as const;
        }),
      );
    });
  }
}
