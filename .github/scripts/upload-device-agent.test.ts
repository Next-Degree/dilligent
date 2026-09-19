import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, 'upload-device-agent.sh');
let directory: string;
let env: Record<string, string>;
const artifacts = [
  'Dilligent-Device-Agent-1.2.3-arm64.dmg',
  'Dilligent-Device-Agent-1.2.3-x64.dmg',
  'Dilligent-Device-Agent-1.2.3-setup.exe',
  'Dilligent-Device-Agent-1.2.3-amd64.deb',
  'Dilligent-Device-Agent-1.2.3-x86_64.AppImage',
  'Dilligent-Device-Agent-1.2.3-arm64.zip',
  'Dilligent-Device-Agent-1.2.3-x64.zip',
  'Dilligent-Device-Agent-1.2.3-arm64.zip.blockmap',
  'Dilligent-Device-Agent-1.2.3-x64.zip.blockmap',
  'Dilligent-Device-Agent-1.2.3-setup.exe.blockmap',
  'Dilligent-Device-Agent-1.2.3-x86_64.AppImage.blockmap',
  'latest-mac.yml',
  'latest.yml',
  'latest-linux.yml',
];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'device-agent-upload-'));
  mkdirSync(join(directory, 'artifacts'));
  for (const artifact of artifacts)
    writeFileSync(join(directory, 'artifacts', artifact), 'fixture');
  // Intercept the real publication script at its external S3 boundary.
  writeFileSync(
    join(directory, 'aws'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$UPLOAD_LOG"
if [[ -n "\${FAIL_MATCH:-}" && "$*" == *"$FAIL_MATCH"* ]]; then exit 1; fi
`,
  );
  chmodSync(join(directory, 'aws'), 0o755);
  env = {
    PATH: `${directory}:${process.env.PATH}`,
    UPLOAD_LOG: join(directory, 'calls'),
    AWS_ACCESS_KEY_ID: 'neon-key',
    AWS_SECRET_ACCESS_KEY: 'neon-secret',
    AWS_REGION: 'us-east-2',
    AWS_ENDPOINT_URL_S3: 'https://branch.storage.example.com',
    S3_BUCKET: 'releases',
    S3_ENV: 'staging',
    VERSION: '1.2.3',
  };
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run() {
  return spawnSync('bash', [script], { cwd: directory, env, encoding: 'utf8' });
}

describe('Neon release publication', () => {
  test.each(['staging', 'production'])(
    'publishes %s payloads before manifests using the branch endpoint',
    (channel) => {
      env.S3_ENV = channel;
      const result = run();
      expect(result.status).toBe(0);
      const calls = readFileSync(env.UPLOAD_LOG, 'utf8').trim().split('\n');
      expect(calls[0]).toBe('configure set default.s3.addressing_style path');
      const transfers = calls.filter((call) => call.includes(' s3 cp '));
      expect(transfers).toHaveLength(21);
      for (const call of transfers) {
        expect(call).toStartWith('--endpoint-url https://branch.storage.example.com s3 cp ');
        expect(call).toContain(`s3://releases/device-agent/${channel}/`);
      }
      expect(transfers.slice(-3).every((call) => call.includes('.yml'))).toBe(true);
      expect(transfers.slice(0, -3).every((call) => !call.includes('.yml'))).toBe(true);
      expect(transfers.some((call) => call.includes('/macos/latest-arm64.dmg'))).toBe(true);
      expect(transfers.some((call) => call.includes('/linux/latest-amd64.deb'))).toBe(true);
    },
  );

  test.each([
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_ENDPOINT_URL_S3',
    'S3_BUCKET',
  ])('rejects missing %s before calling S3', (name) => {
    delete env[name];
    expect(run().status).toBe(1);
    expect(() => readFileSync(env.UPLOAD_LOG)).toThrow();
  });

  test.each(artifacts)(
    'rejects an incomplete build missing %s before publishing anything',
    (artifact) => {
      rmSync(join(directory, 'artifacts', artifact));
      expect(run().status).toBe(1);
      expect(() => readFileSync(env.UPLOAD_LOG)).toThrow();
    },
  );

  test('does not publish latest pointers or manifests after a failed payload', () => {
    env.FAIL_MATCH = 'updates/Dilligent-Device-Agent-1.2.3-arm64.zip';
    expect(run().status).toBe(1);
    const calls = readFileSync(env.UPLOAD_LOG, 'utf8');
    expect(calls).not.toContain('.yml');
    expect(calls).not.toContain('/latest-');
  });
});
