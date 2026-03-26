import { describe, it, expect } from 'vitest';
import {
  IMAGE_MIME_TYPES,
  IMAGE_MIME_EXTENSION_MAP,
  MAX_IMAGE_FILE_SIZE,
  isImageMimeType,
  isImageFile,
  getImageExtension,
  validateImageFile,
  validateImageMagicNumber,
} from '../../../src/utils/image.js';

describe('Image Utilities', () => {
  describe('isImageMimeType', () => {
    it('should return true for valid image MIME types', () => {
      expect(isImageMimeType('image/jpeg')).toBe(true);
      expect(isImageMimeType('image/png')).toBe(true);
      expect(isImageMimeType('image/webp')).toBe(true);
    });

    it('should return false for invalid MIME types', () => {
      expect(isImageMimeType('text/plain')).toBe(false);
      expect(isImageMimeType('application/pdf')).toBe(false);
      expect(isImageMimeType('video/mp4')).toBe(false);
    });
  });

  describe('isImageFile', () => {
    it('should return true for Blob with valid image MIME type', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      expect(isImageFile(blob)).toBe(true);
    });

    it('should return false for Blob with invalid MIME type', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      expect(isImageFile(blob)).toBe(false);
    });
  });

  describe('getImageExtension', () => {
    it('should return correct extension for JPEG', () => {
      expect(getImageExtension('image/jpeg')).toBe('.jpg');
    });

    it('should return correct extension for PNG', () => {
      expect(getImageExtension('image/png')).toBe('.png');
    });

    it('should return correct extension for WEBP', () => {
      expect(getImageExtension('image/webp')).toBe('.webp');
    });

    it('should return undefined for unknown MIME type', () => {
      expect(getImageExtension('text/plain')).toBeUndefined();
    });
  });

  describe('validateImageFile', () => {
    it('should validate correct image file', () => {
      const file = new Blob(['small content'], { type: 'image/png' });
      const result = validateImageFile(file);
      
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid MIME type', () => {
      const file = new Blob(['test'], { type: 'text/plain' });
      const result = validateImageFile(file);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid file type');
    });

    it('should reject file exceeding size limit', () => {
      // Create a blob that exceeds MAX_IMAGE_FILE_SIZE (5MB)
      const largeContent = new Uint8Array(MAX_IMAGE_FILE_SIZE + 1);
      const file = new Blob([largeContent], { type: 'image/jpeg' });
      const result = validateImageFile(file);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5MB limit');
    });

    it('should accept file at or below size limit', () => {
      const content = new Uint8Array(MAX_IMAGE_FILE_SIZE - 1000);
      const file = new Blob([content], { type: 'image/png' });
      const result = validateImageFile(file);
      
      expect(result.valid).toBe(true);
    });
  });

  describe('validateImageMagicNumber', () => {
    it('should validate JPEG magic number', () => {
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(validateImageMagicNumber('image/jpeg', jpegHeader)).toBe(true);
    });

    it('should validate PNG magic number', () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(validateImageMagicNumber('image/png', pngHeader)).toBe(true);
    });

    it('should validate WEBP magic number', () => {
      const webpHeader = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
      expect(validateImageMagicNumber('image/webp', webpHeader)).toBe(true);
    });

    it('should reject invalid JPEG magic number', () => {
      const invalidHeader = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(validateImageMagicNumber('image/jpeg', invalidHeader)).toBe(false);
    });

    it('should reject invalid PNG magic number', () => {
      const invalidHeader = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(validateImageMagicNumber('image/png', invalidHeader)).toBe(false);
    });

    it('should return false for unknown MIME type', () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(validateImageMagicNumber('text/plain', buffer)).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have correct MIME types array', () => {
      expect(IMAGE_MIME_TYPES).toContain('image/jpeg');
      expect(IMAGE_MIME_TYPES).toContain('image/png');
      expect(IMAGE_MIME_TYPES).toContain('image/webp');
      expect(IMAGE_MIME_TYPES.length).toBe(3);
    });

    it('should have extension map with all MIME types', () => {
      expect(IMAGE_MIME_EXTENSION_MAP['image/jpeg']).toBe('.jpg');
      expect(IMAGE_MIME_EXTENSION_MAP['image/png']).toBe('.png');
      expect(IMAGE_MIME_EXTENSION_MAP['image/webp']).toBe('.webp');
    });

    it('should have correct max file size', () => {
      expect(MAX_IMAGE_FILE_SIZE).toBe(5 * 1024 * 1024);
    });
  });
});
