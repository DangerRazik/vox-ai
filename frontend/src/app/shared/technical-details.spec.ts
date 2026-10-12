import { TestBed } from '@angular/core/testing';
import { TechnicalDetails } from './technical-details';

it('показывает доступные ID текстом без отдельного блока и кнопок', () => {
  const fixture = TestBed.createComponent(TechnicalDetails);
  fixture.componentRef.setInput('ids', [
    { label: 'ID стрима', value: 'stream-123' },
    { label: 'ID загрузки', value: undefined },
  ]);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.textContent).toContain('ID стрима: stream-123');
  expect(element.textContent).not.toContain('ID загрузки');
  expect(element.querySelector('details, button')).toBeNull();
});
