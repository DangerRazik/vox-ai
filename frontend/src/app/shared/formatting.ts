const numbers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatNumber(value: number): string {
  return numbers.format(value);
}

export function formatFileSize(bytes: number): string {
  const units = ['КБ', 'МБ', 'ГБ'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${formatNumber(size)} ${units[unit]}`;
}

const dates = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});
export function formatDateTime(value: string): string {
  return dates.format(new Date(value));
}
export function formatBoundary(seconds: number): string {
  const total = Math.round(seconds * 1000);
  const minutes = Math.floor(total / 60000);
  const wholeSeconds = Math.floor(total / 1000) % 60;
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}${millis ? ',' + String(millis).padStart(3, '0') : ''}`;
}
