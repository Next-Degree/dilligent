/**
 * Writes browser automation screenshots (stored as S3 keys) into a ZIP folder.
 */

import {
  appendAttachmentToArchive,
  createFilenameTracker,
  type ArchiveSink,
} from './evidence-attachment-streamer';

/** `2026-02-03T04:05:06.000Z` → `2026-02-03_040506`, always in UTC. */
export function utcFileStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, '')}`;
}

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
  archive: ArchiveSink;
  folderPath: string;
}) {
  const tracker = createFilenameTracker();
  const paths = new Map<string, string>();
  const counts = { written: 0, missing: 0 };

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
    const existing = paths.get(key);
    if (existing) return existing;

    let entryName = '';
    const result = await appendAttachmentToArchive({
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
    counts[result] += 1;
    const relativePath = `screenshots/${entryName}`;
    paths.set(key, relativePath);
    return relativePath;
  };

  return { write, counts: () => ({ ...counts }) };
}
