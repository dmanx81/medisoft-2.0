import sharp from 'sharp';
import { ClinicalError } from './types';

const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
type ImageMeta = { format?: string; width?: number; height?: number };
const inspect = sharp as unknown as (
  input: Buffer,
  options?: { failOn: 'error' },
) => { metadata: () => Promise<ImageMeta> };

export async function assertSafeImage(file: {
  type: string;
  bytes: Buffer;
  name?: string;
}) {
  const name = (file.name || 'image').replace(/\\/g, '/').split('/').pop() || 'image';
  if (name.includes('..'))
    throw new ClinicalError(400, 'VALIDATION', 'The file name is not allowed.');
  if (!allowedTypes.has(file.type))
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Upload a PNG, JPEG or WebP image.',
      { logo: 'Unsupported image type.' },
    );
  if (file.bytes.length < 32 || file.bytes.length > 262144)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Image files must be between 32 bytes and 256 KB.',
      { logo: 'Choose a smaller image.' },
    );
  let meta: ImageMeta;
  try {
    meta = await inspect(file.bytes, { failOn: 'error' }).metadata();
  } catch {
    throw new ClinicalError(400, 'VALIDATION', 'The file is not a valid image.', {
      logo: 'The image could not be read.',
    });
  }
  if (
    (meta.format !== 'png' && meta.format !== 'jpeg' && meta.format !== 'webp') ||
    (meta.width ?? 0) < 16 ||
    (meta.height ?? 0) < 16 ||
    (meta.width ?? 0) > 2000 ||
    (meta.height ?? 0) > 2000
  )
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Images must be between 16×16 and 2000×2000 pixels.',
      { logo: 'Resize the image and try again.' },
    );
  return { type: file.type, bytes: file.bytes, name };
}
