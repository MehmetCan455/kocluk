import { Modal } from './Modal';
import { ZoomableImage } from './ZoomableImage';

export interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt: string;
  title: string;
  onClose: () => void;
}

/** Full-screen note-image viewer with zoom, pan and pinch support. */
export function ImageLightbox({ open, src, alt, title, onClose }: ImageLightboxProps) {
  return (
    <Modal open={open} title={title} onClose={onClose} variant="fullscreen">
      <ZoomableImage src={src} alt={alt} />
    </Modal>
  );
}
