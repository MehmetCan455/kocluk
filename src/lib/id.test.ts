import { afterEach, expect, test, vi } from 'vitest';
import { newId } from './id';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

test('newId secure context varsa randomUUID kullanır', () => {
  vi.stubGlobal('crypto', {
    randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
  });

  expect(newId()).toBe('123e4567-e89b-42d3-a456-426614174000');
});

test('newId randomUUID yokken geçerli bir UUIDv4 üretir', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = index;
      }
      return bytes;
    },
  });

  expect(newId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  expect(newId()).toMatch(UUID_V4);
});
