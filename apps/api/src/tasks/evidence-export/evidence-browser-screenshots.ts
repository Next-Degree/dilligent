/**
 * Writes browser automation screenshots (stored as S3 keys) into a ZIP folder.
 */

import type { Archiver } from 'archiver';
import {
  appendAttachmentToArchive,
  createFilenameTracker,
} from './evidence-attachment-streamer';

function screenshotExtension(key: string): string {
  const match = /\.([a-z0-9]{2,5})$/i.exec(key);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}

/**
 * One automation's screenshots share a filename tracker and a key cache, so a
 * run-level screenshot that is the same object as its last step's screenshot
 * is written once and both CSV rows point at the same file.
 */
export function createScreenshotWriter({
  archive,
  folderPath,
}: {
  archive: Archiver;
  folderPath: string;
}) {
  const tracker = createFilenameTracker();
  const written = new Map<string, string>();
  let count = 0;

  const write = async ({
    key,
    baseName,
    ownerId,
    createdAt,
  }: {
    key: string | null;
    baseName: string;
    ownerId: string;
    createdAt: Date;
  }): Promise<string> => {
    // Stored values are S3 keys; anything else is not in our bucket.
    if (!key || /^https?:\/\//i.test(key)) return '';
    const existing = written.get(key);
    if (existing) return existing;

    let entryName = '';
    await appendAttachmentToArchive({
      archive,
      attachment: {
        id: ownerId,
        name: `${baseName}${screenshotExtension(key)}`,
        url: key,
        type: 'image',
        createdAt,
      },
      folderPath: `${folderPath}/screenshots`,
      uniqueName: (rawName) => {
        entryName = tracker(rawName);
        return entryName;
      },
    });
    const relativePath = `screenshots/${entryName}`;
    written.set(key, relativePath);
    count += 1;
    return relativePath;
  };

  return { write, count: () => count };
}
