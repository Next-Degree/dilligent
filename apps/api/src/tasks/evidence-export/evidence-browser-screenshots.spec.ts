import { Readable } from 'node:stream';

const mockSend = jest.fn();
jest.mock('../../app/s3', () => ({
  BUCKET_NAME: 'test-bucket',
  s3Client: { send: (...args: unknown[]) => mockSend(...args) },
}));
jest.mock('@db', () => ({
  db: {},
  AttachmentEntityType: { task: 'task' },
}));

import {
  createScreenshotWriter,
  utcFileStamp,
} from './evidence-browser-screenshots';

const createdAt = new Date('2026-02-03T04:05:06.000Z');

function setup() {
  const archive = { append: jest.fn() };
  const writer = createScreenshotWriter({ archive, folderPath: 'auto' });
  return { archive, writer };
}

describe('utcFileStamp', () => {
  it('formats in UTC regardless of the process time zone', () => {
    expect(utcFileStamp(new Date('2026-12-31T23:59:58.123Z'))).toBe(
      '2026-12-31_235958',
    );
  });
});

describe('createScreenshotWriter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('streams the S3 body into screenshots/ and counts it as written', async () => {
    const body = Readable.from([Buffer.from('JPEG')]);
    mockSend.mockResolvedValue({ Body: body });
    const { archive, writer } = setup();

    const path = await writer.write({
      key: 'browser-automations/org_1/bau/bar.jpg',
      baseName: 'shot',
      ownerId: 'bar_1',
      createdAt,
    });

    expect(path).toBe('screenshots/shot.jpg');
    expect(archive.append).toHaveBeenCalledWith(body, {
      name: 'auto/screenshots/shot.jpg',
    });
    expect(writer.counts()).toEqual({ written: 1, missing: 0 });
  });

  it('writes a _MISSING_ placeholder for a deleted object and counts it as missing', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'NoSuchKey' }),
    );
    const { archive, writer } = setup();

    const path = await writer.write({
      key: 'k.png',
      baseName: 'shot',
      ownerId: 'bar_1',
      createdAt,
    });

    expect(path).toBe('screenshots/_MISSING_shot.png.txt');
    expect(archive.append.mock.calls[0][1]).toEqual({
      name: 'auto/screenshots/_MISSING_shot.png.txt',
    });
    expect(writer.counts()).toEqual({ written: 0, missing: 1 });
  });

  it('fails loudly on non-404 S3 errors instead of writing a placeholder', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'AccessDenied' }),
    );
    const { archive, writer } = setup();

    await expect(
      writer.write({ key: 'k.jpg', baseName: 's', ownerId: 'b', createdAt }),
    ).rejects.toThrow('denied');
    expect(archive.append).not.toHaveBeenCalled();
  });

  it('downloads a key once and reuses its path for later references', async () => {
    mockSend.mockImplementation(() =>
      Promise.resolve({ Body: Readable.from([Buffer.from('X')]) }),
    );
    const { writer } = setup();
    const shared = { ownerId: 'bar_1', createdAt, key: 'k.jpg' };

    const first = await writer.write({ ...shared, baseName: 'run' });
    const second = await writer.write({ ...shared, baseName: 'step-2' });

    expect(second).toBe(first);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(writer.counts()).toEqual({ written: 1, missing: 0 });
  });

  it('ignores empty values and full URLs (not keys in our bucket)', async () => {
    const { writer } = setup();
    const shared = { baseName: 's', ownerId: 'b', createdAt };

    await expect(writer.write({ ...shared, key: null })).resolves.toBe('');
    await expect(
      writer.write({ ...shared, key: 'https://x.s3.amazonaws.com/k.jpg' }),
    ).resolves.toBe('');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
