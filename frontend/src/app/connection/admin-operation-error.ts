import { HttpErrorResponse } from '@angular/common/http';
import { connectionError } from './api-connection';

export function adminOperationError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 422)
    return 'Сервер отклонил настройки или материалы. Проверьте обязательные поля, шаблоны промптов и содержимое файлов.';
  if (error instanceof HttpErrorResponse && error.status === 404)
    return 'Заказчик или стрим не найден. Обновите список.';
  if (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
    return connectionError(error);
  return 'Подтверждение операции не получено. Сначала обновите список: ресурс мог быть создан на сервере. Введённые данные сохранены.';
}
