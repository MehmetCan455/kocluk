import { render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Photo } from '@/domain/types';
import { PhotoThumb } from './PhotoThumb';

function photoWith(id: string, thumbBlob: Blob): Photo {
  return {
    id,
    examType: 'TYT',
    subjectId: 'ders',
    note: 'Soru',
    blob: new Blob(['tam'], { type: 'image/jpeg' }),
    thumbBlob,
    width: 1,
    height: 1,
    mastered: false,
    practiceCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

test('aynı fotoğrafın yeni Blob örneği URL yeniden oluşturmaz', () => {
  const createUrlSpy = vi.spyOn(URL, 'createObjectURL');
  const photo = photoWith('p1', new Blob(['küçük'], { type: 'image/jpeg' }));

  const { rerender } = render(<PhotoThumb photo={photo} />);
  expect(createUrlSpy).toHaveBeenCalledTimes(1);

  rerender(
    <PhotoThumb
      photo={{ ...photo, thumbBlob: new Blob(['küçük'], { type: 'image/jpeg' }) }}
    />,
  );
  expect(createUrlSpy).toHaveBeenCalledTimes(1);

  rerender(<PhotoThumb photo={photoWith('p2', new Blob(['küçük'], { type: 'image/jpeg' }))} />);
  expect(createUrlSpy).toHaveBeenCalledTimes(2);

  createUrlSpy.mockRestore();
});
