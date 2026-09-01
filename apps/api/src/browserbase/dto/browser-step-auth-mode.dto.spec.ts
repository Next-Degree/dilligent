// The DTO module imports TaskFrequency from '@db' at runtime, which would pull
// in a live Prisma client; these validators need none of it.
jest.mock('@db', () => ({
  TaskFrequency: { daily: 'daily', weekly: 'weekly', monthly: 'monthly' },
}));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BrowserAutomationStepDto,
  CreateBrowserAutomationDraftDto,
  DraftStepDto,
  TestInstructionDto,
} from './browserbase.dto';

const errorsFor = async (
  cls: new () => object,
  plain: Record<string, unknown>,
) => validate(plainToInstance(cls, plain), { whitelist: true });

const propertiesIn = (errors: Awaited<ReturnType<typeof validate>>) =>
  errors.map((error) => error.property);

describe('DraftStepDto targetUrl validation', () => {
  // Public mode makes a draft's targetUrl the first evidence URL that comes
  // from user input rather than from a server-created connection, so it needs
  // the same URL-safety rules every other target URL goes through.
  it('accepts an ordinary public page URL', async () => {
    const errors = await errorsFor(DraftStepDto, {
      authMode: 'public',
      targetUrl: 'https://example.com/privacy',
      instruction: 'capture the privacy policy',
    });
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['the cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
    ['a private network address', 'http://10.0.0.1/admin'],
    ['localhost', 'http://localhost:8080/'],
    ['a non-web scheme', 'file:///etc/passwd'],
    ['a bare hostname', 'not-a-url'],
  ])('rejects %s', async (_label, targetUrl) => {
    const errors = await errorsFor(DraftStepDto, { targetUrl });
    expect(propertiesIn(errors)).toContain('targetUrl');
  });

  it('still allows a half-written draft with no URL at all', async () => {
    const errors = await errorsFor(DraftStepDto, {
      instruction: 'capture the privacy policy',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unsafe URL nested inside a draft’s steps', async () => {
    const errors = await errorsFor(CreateBrowserAutomationDraftDto, {
      taskId: 'tsk_1',
      steps: [{ targetUrl: 'http://169.254.169.254/' }],
    });
    expect(propertiesIn(errors)).toContain('steps');
  });
});

describe('authMode validation', () => {
  it.each([
    ['a saved step', BrowserAutomationStepDto],
    ['a draft step', DraftStepDto],
    ['a test request', TestInstructionDto],
  ])('rejects an unknown authMode on %s', async (_label, cls) => {
    const errors = await errorsFor(cls, {
      authMode: 'no_login_at_all',
      targetUrl: 'https://example.com/privacy',
      instruction: 'capture the privacy policy',
    });
    expect(propertiesIn(errors)).toContain('authMode');
  });

  it.each(['saved_session', 'public'])('accepts %s', async (authMode) => {
    const errors = await errorsFor(BrowserAutomationStepDto, {
      authMode,
      targetUrl: 'https://example.com/privacy',
      instruction: 'capture the privacy policy',
    });
    expect(errors).toHaveLength(0);
  });

  it('leaves authMode optional, so legacy payloads still validate', async () => {
    const errors = await errorsFor(BrowserAutomationStepDto, {
      profileId: 'bap_1',
      targetUrl: 'https://vendor.example.com/settings',
      instruction: 'capture the MFA policy',
    });
    expect(errors).toHaveLength(0);
  });
});
