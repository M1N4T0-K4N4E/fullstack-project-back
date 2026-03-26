
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const IMAGE_MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;

export const isImageMimeType = (mimeType: string): boolean => {
  return IMAGE_MIME_TYPES.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number]);
};

export const isImageFile = (file: Blob): boolean => {
  return isImageMimeType(file.type);
};

export const getImageExtension = (mimeType: string): string | undefined => {
  return IMAGE_MIME_EXTENSION_MAP[mimeType];
};

export const validateImageFile = (file: Blob): { valid: boolean; error?: string } => {
  if (!isImageFile(file)) {
    return { valid: false, error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' };
  }

  if (file.size > MAX_IMAGE_FILE_SIZE) {
    return { valid: false, error: 'File size exceeds the 5MB limit.' };
  }

  return { valid: true };
};

export const validateImageMagicNumber = (mimeType: string, buffer: Buffer): boolean => {
  const header = buffer.subarray(0, 12);

  if (mimeType === 'image/jpeg') {
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    return header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  }

  if (mimeType === 'image/webp') {
    const isRiff = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;
    const isWebp = header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
    return isRiff && isWebp;
  }

  return false;
};