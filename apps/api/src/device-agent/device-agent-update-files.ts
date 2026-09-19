const ALLOWED_EXTENSIONS = new Set([
  '.yml',
  '.zip',
  '.exe',
  '.blockmap',
  '.AppImage',
  '.dmg',
]);

export const CONTENT_TYPES: Record<string, string> = {
  '.yml': 'text/yaml',
  '.zip': 'application/zip',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.AppImage': 'application/octet-stream',
  '.dmg': 'application/x-apple-diskimage',
};

/**
 * Binaries are presigned + redirected so the client downloads directly from
 * S3, bypassing proxy/function timeouts. Manifests are tiny enough to stream.
 */
export const REDIRECT_EXTENSIONS = new Set([
  '.zip',
  '.exe',
  '.blockmap',
  '.AppImage',
  '.dmg',
]);

export const PRESIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export function getExtension(filename: string): string {
  if (filename.endsWith('.AppImage')) return '.AppImage';
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex) : '';
}

export function isValidFilename(filename: string): boolean {
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return false;
  }
  return ALLOWED_EXTENSIONS.has(getExtension(filename));
}
