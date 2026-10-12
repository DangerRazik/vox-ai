import { CRITERIA } from '../reports/report-models';
import { TestBed } from '@angular/core/testing';
import { StreamForm, StreamFormValue } from './stream-form';
import { StreamConfiguration } from './admin-streams-source';

async function render(initialConfiguration?: StreamConfiguration, initialWhisperPrompt = '') {
  await TestBed.configureTestingModule({ imports: [StreamForm] }).compileComponents();
  const fixture = TestBed.createComponent(StreamForm);
  if (initialConfiguration)
    fixture.componentRef.setInput('initialConfiguration', initialConfiguration);
  fixture.componentRef.setInput('initialWhisperPrompt', initialWhisperPrompt);
  const submitted: StreamFormValue[] = [];
  fixture.componentInstance.submitted.subscribe((value) => submitted.push(value));
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const input = (name: string) =>
    element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  const fill = async (name: string, value: string) => {
    input(name).value = value;
    input(name).dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const toggle = async (label: string, checked: boolean) => {
    const checkbox = [...element.querySelectorAll('label')]
      .find((item) => item.textContent?.includes(label))!
      .querySelector<HTMLInputElement>('input')!;
    checkbox.checked = checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
  };
  const file = async (name: string, filename = 'material.txt', text = 'Материал') => {
    const field = input(name) as HTMLInputElement;
    // DOM FileList — браузерная граница, а не внутренний источник приложения.
    Object.defineProperty(field, 'files', {
      configurable: true,
      value: { item: () => new File([text], filename, { type: 'text/plain' }) },
    });
    field.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
  };
  const submit = async () => {
    element
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };
  const basics = async () => {
    await fill('name', ' Правила ');
    await fill('whisperPrompt', ' Распознай речь ');
    await file('knowledgeBase', 'knowledge.txt');
  };
  return { fixture, element, input, submitted, fill, toggle, file, submit, basics };
}

describe('Форма стрима', () => {
  it('создаёт стрим со всеми 11 критериями без чекбоксов выбора', async () => {
    const form = await render();
    await form.basics();
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    expect(form.element.querySelectorAll('.stream-criteria input')).toHaveLength(0);
    expect(form.element.querySelectorAll('.stream-criteria li')).toHaveLength(11);
    await form.submit();
    expect(form.submitted[0].enabledCriteria).toEqual(CRITERIA.map((c) => c.id));
    expect(form.submitted[0].options.zeroTotalOnCritical).toBe(true);
  });
  it('создаёт на основе старого подмножества все 11 критериев, не меняя источник', async () => {
    const initial: StreamConfiguration = {
      name: 'Копия',
      whisperPrompt: 'Речь',
      llmPrompt: '',
      enabledCriteria: ['1.1', '5.2'],
      options: {
        tempoAnalysis: true,
        unwantedExpressions: false,
        textCorrections: false,
        zeroTotalOnCritical: true,
      },
    };
    const form = await render(initial);
    await form.file('knowledgeBase');
    await form.submit();
    expect(form.submitted[0].enabledCriteria).toEqual(CRITERIA.map((c) => c.id));
    expect(initial.enabledCriteria).toEqual(['1.1', '5.2']);
  });
  it('не показывает фиксированные технические поля в рабочей форме', async () => {
    const form = await render();
    for (const name of [
      'whisperModel',
      'speechLang',
      'rolePrompt',
      'llmModel',
      'analysisSystemPrompt',
      'analysisUserPrompt',
      'llmPrompt',
    ])
      expect(form.element.querySelector(`[name="${name}"]`)).toBeNull();
    expect(form.input('whisperPrompt')).not.toBeNull();
  });

  it('подставляет настройки исходного стрима, но требует новые файлы; правки не изменяют исходные правила', async () => {
    const initial: StreamConfiguration = {
      name: 'Старый стрим',
      whisperPrompt: 'Старый Whisper',
      llmPrompt: 'Старый LLM',
      options: {
        tempoAnalysis: false,
        unwantedExpressions: true,
        textCorrections: false,
        zeroTotalOnCritical: false,
      },
    };
    const form = await render(initial);
    expect(form.input('name').value).toBe('Старый стрим');
    expect(form.input('whisperPrompt').value).toBe('Старый Whisper');
    expect(form.element.querySelector('[name=llmPrompt]')).toBeNull();
    await form.submit();
    expect(form.submitted).toEqual([]);
    expect(form.element.textContent).toContain('Приложите непустой файл базы знаний');
    expect(form.element.textContent).toContain(
      'Приложите непустой словарь нежелательных выражений',
    );
    expect(form.element.textContent).not.toContain(
      'Приложите непустой словарь корректировки текста',
    );
    await form.fill('name', 'Копия');
    await form.toggle('Поиск нежелательных выражений', false);
    await form.file('knowledgeBase', 'new-kb.txt');
    await form.submit();
    expect(form.submitted[0].materials.knowledgeBase.name).toBe('new-kb.txt');
    expect(form.submitted[0].options.zeroTotalOnCritical).toBe(false);
    expect(form.submitted[0].options.tempoAnalysis).toBe(false);
    expect(initial.name).toBe('Старый стрим');
    expect(initial.options.unwantedExpressions).toBe(true);
  });
  it('поясняет обязательность имени и базы знаний, сохраняя введённые значения', async () => {
    const form = await render();
    await form.fill('name', '   ');
    await form.fill('whisperPrompt', 'Промпт сохранён');
    await form.submit();
    expect(form.element.textContent).toContain('Укажите название стрима');
    expect(form.element.textContent).toContain('Приложите непустой файл базы знаний');
    expect(form.input('whisperPrompt').value).toBe('Промпт сохранён');
    expect(form.submitted).toEqual([]);
  });
  it('требует оба словаря при включённых опциях; выключение снимает условия', async () => {
    const form = await render();
    await form.basics();
    await form.submit();
    expect(form.element.textContent).toContain(
      'Приложите непустой словарь нежелательных выражений',
    );
    expect(form.element.textContent).toContain('Приложите непустой словарь корректировки текста');
    expect(form.submitted).toEqual([]);
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    await form.submit();
    expect(form.submitted).toHaveLength(1);
    expect(form.submitted[0].materials.unwantedExpressions).toBeNull();
    expect(form.submitted[0].materials.textCorrections).toBeNull();
    expect(form.submitted[0].options.zeroTotalOnCritical).toBe(true);
    expect(form.submitted[0].name).toBe('Правила');
  });
  it('повторное включение опции снова требует её словарь', async () => {
    const form = await render();
    await form.basics();
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    await form.toggle('Поиск нежелательных выражений', true);
    await form.submit();
    expect(form.submitted).toEqual([]);
    expect(form.element.textContent).toContain(
      'Приложите непустой словарь нежелательных выражений',
    );
    expect(form.element.textContent).not.toContain(
      'Приложите непустой словарь корректировки текста',
    );
  });
  it('не принимает пустой файл базы знаний', async () => {
    const form = await render();
    await form.basics();
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    await form.file('knowledgeBase', 'empty.txt', '');
    await form.submit();
    expect(form.element.textContent).toContain('Приложите непустой файл базы знаний');
    expect(form.submitted).toEqual([]);
  });
  it('не принимает пустой обязательный словарь и сохраняет остальные файлы при исправлении', async () => {
    const form = await render();
    await form.basics();
    await form.file('unwantedExpressions', 'empty.txt', '');
    await form.file('textCorrections', 'corrections.txt', 'ошибка=правильно');
    await form.submit();
    expect(form.submitted).toEqual([]);
    await form.file('unwantedExpressions', 'unwanted.txt', 'нежелательное слово');
    await form.submit();
    expect(form.submitted[0].materials.knowledgeBase.name).toBe('knowledge.txt');
    expect(form.submitted[0].materials.textCorrections?.name).toBe('corrections.txt');
    expect(form.submitted[0].materials.unwantedExpressions?.name).toBe('unwanted.txt');
    expect(form.input('whisperPrompt').value).toBe(' Распознай речь ');
    expect(form.element.querySelectorAll('li')).toHaveLength(11);
  });
  it('сохраняет настройки и файлы при ошибке запроса, позволяет исправление и повтор', async () => {
    const form = await render();
    await form.basics();
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    await form.toggle('Обнулять итог при критическом нарушении', false);
    form.fixture.componentRef.setInput('requestError', 'Сбой создания');
    await form.fixture.whenStable();
    expect(form.input('name').value).toBe(' Правила ');
    expect(form.element.querySelector('button')?.textContent).toContain('Повторить создание');
    await form.fill('whisperPrompt', 'Новая терминология');
    await form.submit();
    expect(form.submitted[0].whisperPrompt).toBe('Новая терминология');
    expect(form.submitted[0].materials.knowledgeBase.name).toBe('knowledge.txt');
    expect(form.submitted[0].options.zeroTotalOnCritical).toBe(false);
  });
  it('не отправляет повторный запрос при блокировке формы и сохраняет ввод', async () => {
    const form = await render();
    await form.basics();
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    form.fixture.componentRef.setInput('locked', true);
    await form.fixture.whenStable();
    await form.submit();
    expect(form.submitted).toEqual([]);
    expect(form.element.querySelector('fieldset')?.disabled).toBe(true);
    expect(form.input('name').value).toBe(' Правила ');
    form.fixture.componentRef.setInput('locked', false);
    await form.fixture.whenStable();
    await form.submit();
    expect(form.submitted[0].materials.knowledgeBase.name).toBe('knowledge.txt');
  });
});

describe('Форма настоящего REST-стрима', () => {
  const initial: StreamConfiguration = {
    name: 'Правила',
    whisperPrompt: '',
    llmPrompt: '',
    options: {
      tempoAnalysis: true,
      unwantedExpressions: true,
      textCorrections: true,
      zeroTotalOnCritical: true,
    },
    processing: {
      longPauseSec: 2,
      interruptionGapSec: 0.2,
    },
  };
  it('требует новые файлы при копировании полной конфигурации, допускает пустой Whisper и сохраняет выбранные материалы при исправлении', async () => {
    const form = await render(initial);
    await form.submit();
    expect(form.submitted).toEqual([]);
    expect(form.element.textContent).toContain('Приложите непустой файл базы знаний');
    await form.file('knowledgeBase', 'kb.txt');
    await form.file('textCorrections', 'corrections.json', '{"ошпка":"ошибка"}');
    await form.file('unwantedExpressions', 'unwanted.json', '["плохое слово"]');
    await form.fill('longPauseSec', '-1');
    await form.submit();
    expect(form.submitted).toEqual([]);
    expect(form.input('longPauseSec').getAttribute('aria-invalid')).toBe('true');
    await form.fill('longPauseSec', '3');
    await form.submit();
    expect(form.submitted).toHaveLength(1);
    expect(form.submitted[0].whisperPrompt).toBe('');
    expect(form.submitted[0].processing?.longPauseSec).toBe(3);
    expect(form.submitted[0].materials.textCorrections?.name).toBe('corrections.json');
    expect(initial.processing?.longPauseSec).toBe(2);
  });
  it('создаёт стрим без ввода фиксированных настроек и не показывает служебные значения', async () => {
    const form = await render();
    await form.fill('name', 'Новый стрим');
    await form.file('knowledgeBase');
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    await form.submit();
    expect(form.submitted).toHaveLength(1);
    expect(form.submitted[0].processing).toEqual({ longPauseSec: 2, interruptionGapSec: 0.2 });
    expect(form.element.textContent).not.toContain('API_KEY');
    expect(form.element.textContent).not.toContain('Демо проверяет');
  });
  it('подставляет исходный Whisper и отправляет его правки', async () => {
    const form = await render(undefined, 'Компания из исходного кода');
    expect(form.input('whisperPrompt').value).toBe('Компания из исходного кода');
    await form.fill('whisperPrompt', 'Термины заказчика');
    await form.fill('name', 'Новый стрим');
    await form.file('knowledgeBase');
    await form.toggle('Поиск нежелательных выражений', false);
    await form.toggle('Корректировка текста транскрипции', false);
    await form.submit();
    expect(form.submitted[0].whisperPrompt).toBe('Термины заказчика');
  });
});
