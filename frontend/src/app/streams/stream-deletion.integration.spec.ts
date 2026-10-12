import { TestBed } from '@angular/core/testing';
import { firstValueFrom, timer } from 'rxjs';
import { DemoAccess } from '../shared/demo-access';
import { DemoUploadsSource } from '../uploads/demo-uploads-source';
import { UploadRequest } from '../uploads/upload-models';
import { DemoAdminStreamsSource } from './demo-admin-streams-source';

// Проверка публичных контрактов двух настоящих демо-источников:
// незавершённый импорт и удаление взаимодействуют без моков модулей/таймеров.
function setup() {
  TestBed.configureTestingModule({});
  TestBed.inject(DemoAccess).open('team');
  const uploads = TestBed.inject(DemoUploadsSource);
  const streams = TestBed.inject(DemoAdminStreamsSource);
  const request: UploadRequest = {
    organizationId: 'contact-center',
    streamId: 'new-project',
    uploadId: 'upload-1',
    archive: new File(['demo'], 'calls.zip', { type: 'application/zip' }),
    metadata: null,
  };
  const remove = () => firstValueFrom(streams.delete(request.organizationId, request.streamId));
  return { uploads, streams, request, remove };
}
afterEach(() => sessionStorage.removeItem('vox-ai.demo-role'));

describe('Удаление во время демонстрационного импорта', () => {
  it('запрещает удаление пока новый приём не завершён; после завершения разрешает', async () => {
    const { uploads, request, remove } = setup();
    const deletion = remove();
    await firstValueFrom(timer(100));
    const upload = firstValueFrom(uploads.upload(request));
    expect((await deletion).kind).toBe('busy');
    await upload;
    expect((await remove()).kind).toBe('deleted');
  });
  it('отмена подписки приёма снимает занятость', async () => {
    const { uploads, request, remove } = setup();
    const subscription = uploads.upload(request).subscribe();
    subscription.unsubscribe();
    expect((await remove()).kind).toBe('deleted');
  });
  it('ошибка приёма снимает занятость, сохраняя возможность удалить принятые данные', async () => {
    const { uploads, request, remove } = setup();
    uploads.loseConfirmation = true;
    await expect(firstValueFrom(uploads.upload(request))).rejects.toThrow('потеря подтверждения');
    expect((await remove()).kind).toBe('deleted');
  });
  it('повтор первичного импорта также запрещает удаление до завершения', async () => {
    const { uploads, request, remove } = setup();
    uploads.scenario = 'empty';
    const initial = await firstValueFrom(uploads.upload(request));
    const deletion = remove();
    await firstValueFrom(timer(100));
    const restore = firstValueFrom(uploads.restore({ ...request, batchId: initial.batch.id }));
    expect((await deletion).kind).toBe('busy');
    expect((await restore).kind).toBe('restored');
    expect((await remove()).kind).toBe('deleted');
  });
});
