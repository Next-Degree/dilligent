import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { createDeviceAgentStorage } from './device-agent-storage';
import {
  CONTENT_TYPES,
  REDIRECT_EXTENSIONS,
  PRESIGNED_URL_TTL_SECONDS,
  getExtension,
  isValidFilename,
} from './device-agent-update-files';

@Injectable()
export class DeviceAgentService {
  private readonly logger = new Logger(DeviceAgentService.name);
  private storage?: ReturnType<typeof createDeviceAgentStorage>;

  private getStorage() {
    this.storage ??= createDeviceAgentStorage();
    return this.storage;
  }

  private get s3Client() {
    return this.getStorage().client;
  }

  private get fleetBucketName() {
    return this.getStorage().bucket;
  }

  async downloadMacAgent(): Promise<{
    stream: Readable;
    filename: string;
    contentType: string;
  }> {
    try {
      const macosPackageFilename = 'Dilligent-Device-Agent-arm64.dmg';
      const packageKey = `device-agent/${this.getStorage().environment}/macos/latest-arm64.dmg`;

      this.logger.log(`Downloading macOS agent from S3: ${packageKey}`);

      const getObjectCommand = new GetObjectCommand({
        Bucket: this.fleetBucketName,
        Key: packageKey,
      });

      const s3Response = await this.s3Client.send(getObjectCommand);

      if (!s3Response.Body) {
        throw new NotFoundException('macOS agent DMG file not found in S3');
      }

      // Use S3 stream directly as Node.js Readable
      const s3Stream = s3Response.Body as Readable;

      this.logger.log(
        `Successfully retrieved macOS agent: ${macosPackageFilename}`,
      );

      return {
        stream: s3Stream,
        filename: macosPackageFilename,
        contentType: 'application/x-apple-diskimage',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to download macOS agent from S3:', error);
      const s3Error = error as { name?: string };
      if (s3Error.name === 'NoSuchKey' || s3Error.name === 'NotFound') {
        throw new NotFoundException('macOS agent file not found');
      }
      throw new InternalServerErrorException(
        'Failed to download macOS agent. The agent file may not be available in this environment.',
      );
    }
  }

  async downloadWindowsAgent(): Promise<{
    stream: Readable;
    filename: string;
    contentType: string;
  }> {
    try {
      const windowsPackageFilename = 'Dilligent-Device-Agent-setup.exe';
      const packageKey = `device-agent/${this.getStorage().environment}/windows/latest-setup.exe`;

      this.logger.log(`Downloading Windows agent from S3: ${packageKey}`);

      const getObjectCommand = new GetObjectCommand({
        Bucket: this.fleetBucketName,
        Key: packageKey,
      });

      const s3Response = await this.s3Client.send(getObjectCommand);

      if (!s3Response.Body) {
        throw new NotFoundException(
          'Windows agent executable file not found in S3',
        );
      }

      // Use S3 stream directly as Node.js Readable
      const s3Stream = s3Response.Body as Readable;

      this.logger.log(
        `Successfully retrieved Windows agent: ${windowsPackageFilename}`,
      );

      return {
        stream: s3Stream,
        filename: windowsPackageFilename,
        contentType: 'application/octet-stream',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to download Windows agent from S3:', error);
      const s3Error = error as { name?: string };
      if (s3Error.name === 'NoSuchKey' || s3Error.name === 'NotFound') {
        throw new NotFoundException('Windows agent file not found');
      }
      throw new InternalServerErrorException(
        'Failed to download Windows agent. The agent file may not be available in this environment.',
      );
    }
  }

  async getUpdateFile({
    filename,
  }: {
    filename: string;
  }): Promise<UpdateFileResult> {
    if (!isValidFilename(filename)) {
      throw new NotFoundException('Not found');
    }

    const key = `device-agent/${this.getStorage().environment}/updates/${filename}`;
    const ext = getExtension(filename);

    if (REDIRECT_EXTENSIONS.has(ext)) {
      return {
        kind: 'redirect',
        url: await this.signUpdateUrl({ key, method: 'GET' }),
      };
    }

    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    try {
      const command = new GetObjectCommand({
        Bucket: this.fleetBucketName,
        Key: key,
      });
      const s3Response = await this.s3Client.send(command);

      if (!s3Response.Body) {
        throw new NotFoundException('Not found');
      }

      return {
        kind: 'stream',
        stream: s3Response.Body as Readable,
        contentType,
        contentLength:
          typeof s3Response.ContentLength === 'number'
            ? s3Response.ContentLength
            : undefined,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      const s3Error = error as { name?: string };
      if (s3Error.name === 'NoSuchKey') {
        throw new NotFoundException('Not found');
      }
      this.logger.error('Error serving update file:', { key, error });
      throw new InternalServerErrorException('Internal server error');
    }
  }

  async headUpdateFile({
    filename,
  }: {
    filename: string;
  }): Promise<HeadUpdateFileResult> {
    if (!isValidFilename(filename)) {
      throw new NotFoundException('Not found');
    }

    const key = `device-agent/${this.getStorage().environment}/updates/${filename}`;
    const ext = getExtension(filename);

    if (REDIRECT_EXTENSIONS.has(ext)) {
      // S3 signs each HTTP method separately — a GET-signed URL is rejected
      // for HEAD with SignatureDoesNotMatch.
      return {
        kind: 'redirect',
        url: await this.signUpdateUrl({ key, method: 'HEAD' }),
      };
    }

    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    try {
      const command = new HeadObjectCommand({
        Bucket: this.fleetBucketName,
        Key: key,
      });
      const s3Response = await this.s3Client.send(command);

      return {
        kind: 'stream',
        contentType,
        contentLength:
          typeof s3Response.ContentLength === 'number'
            ? s3Response.ContentLength
            : undefined,
      };
    } catch {
      throw new NotFoundException('Not found');
    }
  }

  private async signUpdateUrl({
    key,
    method,
  }: {
    key: string;
    method: 'GET' | 'HEAD';
  }): Promise<string> {
    const command =
      method === 'HEAD'
        ? new HeadObjectCommand({
            Bucket: this.fleetBucketName,
            Key: key,
          })
        : new GetObjectCommand({
            Bucket: this.fleetBucketName,
            Key: key,
          });
    return getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });
  }
}

export type UpdateFileResult =
  | {
      kind: 'stream';
      stream: Readable;
      contentType: string;
      contentLength?: number;
    }
  | { kind: 'redirect'; url: string };

export type HeadUpdateFileResult =
  | { kind: 'stream'; contentType: string; contentLength?: number }
  | { kind: 'redirect'; url: string };
