import { afterEach, vi } from 'vitest';
import { createUuid } from './uuid';

afterEach(() => vi.unstubAllGlobals());

it('создаёт UUID v4 без randomUUID, используя случайные байты браузера', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
  vi.stubGlobal('crypto', { getRandomValues });
  expect(createUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(getRandomValues).toHaveBeenCalledOnce();
  expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
});

it('сохраняет ведущие нули и задаёт версию и вариант UUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) });
  expect(createUuid()).toBe('00000000-0000-4000-8000-000000000000');
});
