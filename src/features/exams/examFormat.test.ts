import { expect, test } from 'vitest';
import { sumNet } from './examFormat';

test('sumNet eski string net değerlerini sayıya çevirip toplar', () => {
  expect(
    sumNet([
      { net: 18.75 },
      // A pre-fix sync could leave a DECIMAL string in IndexedDB.
      { net: '10.25' as unknown as number },
    ]),
  ).toBe(29);

  expect(
    sumNet([
      { net: 18.75 },
      { net: 'bozuk' as unknown as number },
    ]),
  ).toBe(18.75);
});
