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

  // The composer autosaves 900ms after each keystroke, so every one of these is
  // a state the draft endpoint sees while the user types an address. Rejecting
  // them would 400 the whole draft — instruction and criteria included — until
  // the URL happened to become complete.
  it.each([
    ['a scheme with a partial host', 'https://exa'],
    ['no scheme yet', 'example.com/priv'],
    ['a bare word', 'exampl'],
    ['nothing but the scheme', 'https://'],
  ])('accepts %s, so autosave keeps working', async (_label, targetUrl) => {
    const errors = await errorsFor(DraftStepDto, {
      authMode: 'public',
      targetUrl,
      instruction: 'capture the privacy policy',
    });
    expect(errors).toHaveLength(0);
  });

  // The relaxed draft rule is about incompleteness, not about scheme or host:
  // anything that parses as a URL still has to be safe.
  it('does not let a partial-looking unsafe URL through', async () => {
    const errors = await errorsFor(DraftStepDto, { targetUrl: 'file://x' });
    expect(propertiesIn(errors)).toContain('targetUrl');
  });

  // Saving is the path that actually runs the step, and it stays strict.
  it('still rejects a half-typed URL on the save path', async () => {
    const errors = await errorsFor(BrowserAutomationStepDto, {
      authMode: 'public',
      targetUrl: 'https://exa',
      instruction: 'capture the privacy policy',
    });
    expect(propertiesIn(errors)).toContain('targetUrl');
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
