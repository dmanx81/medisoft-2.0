import sharpLib from 'sharp';
import { BrandingError, type ProcessedImage } from './types';

const sharp = sharpLib as unknown as (
  input: SharpInput,
  options?: { failOn?: 'none' | 'truncated' | 'error' | 'warning'; sequentialRead?: boolean },
) => SharpImage;
type SharpInput =
  | Buffer
  | { create: { width: number; height: number; channels: number; background: string } };
type SharpImage = {
  rotate: () => SharpImage;
  metadata: () => Promise<{ width?: number; height?: number }>;
  resize: (options: {
    width: number;
    height: number;
    fit: 'inside';
    withoutEnlargement: boolean;
  }) => SharpImage;
  png: (options?: { compressionLevel?: number; effort?: number }) => SharpImage;
  toBuffer: {
    (): Promise<Buffer>;
    (options: { resolveWithObject: true }): Promise<{
      data: Buffer;
      info: { width: number; height: number };
    }>;
  };
};

const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
const riff = Buffer.from('RIFF', 'ascii');
const webp = Buffer.from('WEBP', 'ascii');

export function detectImageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(png)) return 'image/png';
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(jpeg)) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(riff) &&
    bytes.subarray(8, 12).equals(webp)
  )
    return 'image/webp';
  return null;
}

function unsafeName(name: string) {
  const base = name.replace(/\\/g, '/').split('/').pop() || 'upload';
  if (base.includes('..') || base === '.' || base.length > 160) return 'upload';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
}

export async function processDocumentImage(
  input: Buffer,
  filename: string,
  options: { maxBytes: number; maxWidth: number; maxHeight: number },
): Promise<ProcessedImage> {
  if (input.length === 0)
    throw new BrandingError(400, 'VALIDATION', 'Choose an image to upload.');
  if (input.length > options.maxBytes)
    throw new BrandingError(
      413,
      'INVALID_BODY',
      'The image is too large. Use a file of 2 MB or less.',
    );
  const detected = detectImageType(input);
  if (!detected || !allowed.has(detected))
    throw new BrandingError(
      400,
      'VALIDATION',
      'Upload a PNG, JPEG or WebP image.',
    );
  try {
    const image = sharp(input, { failOn: 'error', sequentialRead: true }).rotate();
    const meta = await image.metadata();
    if (!meta.width || !meta.height)
      throw new BrandingError(400, 'VALIDATION', 'The image could not be read.');
    if (meta.width > 4000 || meta.height > 4000)
      throw new BrandingError(
        400,
        'VALIDATION',
        'The image dimensions are too large.',
      );
    const processed = await image
      .resize({
        width: options.maxWidth,
        height: options.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, effort: 7 })
      .toBuffer({ resolveWithObject: true });
    if (processed.info.width < 16 || processed.info.height < 16)
      throw new BrandingError(
        400,
        'VALIDATION',
        'The image is too small to use on clinical documents.',
      );
    return {
      bytes: processed.data,
      width: processed.info.width,
      height: processed.info.height,
      original_filename: unsafeName(filename),
    };
  } catch (error) {
    if (error instanceof BrandingError) throw error;
    throw new BrandingError(400, 'VALIDATION', 'The image could not be processed.');
  }
}

export async function solidPng(
  width = 120,
  height = 48,
  background = '#0F766E',
) {
  return sharp({
    create: { width, height, channels: 3, background },
  })
    .png()
    .toBuffer();
}
