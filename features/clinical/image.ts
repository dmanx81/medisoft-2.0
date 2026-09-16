import sharp from 'sharp';
import { ClinicalError } from './types';

const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
type ImageMeta = { format?: string; width?: number; height?: number };
const inspect = sharp as unknown as (
  input: Buffer,
  options?: { failOn: 'error' },
) => { metadata: () => Promise<ImageMeta> };
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
const riffMagic = Buffer.from('RIFF', 'ascii');
const webpMagic = Buffer.from('WEBP', 'ascii');

export function detectImageType(
  bytes: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(pngMagic)) return 'image/png';
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(jpegMagic)) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(riffMagic) &&
    bytes.subarray(8, 12).equals(webpMagic)
  )
    return 'image/webp';
  return null;
}

export function asBytea(bytes: Buffer) {
  return Uint8Array.from(bytes);
}

export async function assertSafeImage(file: {
  type: string;
  bytes: Buffer;
  name?: string;
}) {
  const name = (file.name || 'image').replace(/\\/g, '/').split('/').pop() || 'image';
  if (name.includes('..'))
    throw new ClinicalError(400, 'VALIDATION', 'The file name is not allowed.');
  const detected = detectImageType(file.bytes);
  if (!detected || !allowedTypes.has(detected))
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Upload a PNG, JPEG or WebP image.',
      { logo: 'Unsupported image type.' },
    );
  if (file.type && file.type !== detected && allowedTypes.has(file.type))
    throw new ClinicalError(
      400,
      'VALIDATION',
      'The file contents do not match the declared image type.',
      { logo: 'Upload an unmodified PNG, JPEG or WebP image.' },
    );
  if (file.type && !allowedTypes.has(file.type) && file.type !== 'application/octet-stream')
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
  return { type: detected, bytes: file.bytes, name };
}
