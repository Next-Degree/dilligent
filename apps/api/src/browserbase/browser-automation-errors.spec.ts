import { classifyBrowserAutomationError } from './browser-automation-errors';

describe('classifyBrowserAutomationError', () => {
  it('classifies auth expiry as needs_reauth', () => {
    const result = classifyBrowserAutomationError(
      new Error('Session expired. User is not logged in.'),
      'auth',
    );

    expect(result.code).toBe('needs_reauth');
    expect(result.stage).toBe('auth');
    expect(result.needsReauth).toBe(true);
  });

  it('classifies 2FA and device approval as needs_user_action', () => {
    const result = classifyBrowserAutomationError(
      new Error(
        'Login paused because device approval required before continuing',
      ),
      'auth',
    );

    expect(result.code).toBe('needs_user_action');
    expect(result.blockedReason).toContain('Manual 2FA');
  });

  it('classifies captcha and rate limit failures with stable codes', () => {
    expect(
      classifyBrowserAutomationError(new Error('reCAPTCHA required')).code,
    ).toBe('captcha_blocked');
    expect(
      classifyBrowserAutomationError(new Error('429 Too Many Requests')).code,
    ).toBe('rate_limited');
  });

  it('does not expose raw unknown error text to users', () => {
    const result = classifyBrowserAutomationError(
      new Error('internal token abc123'),
    );

    expect(result.code).toBe('unknown');
    expect(result.userFacing).toBe(
      'Browser automation failed for an unknown reason.',
    );
  });

  it('does not classify generic forbidden errors as reauth', () => {
    const result = classifyBrowserAutomationError(
      new Error('403 forbidden while loading report'),
      'navigation',
    );

    expect(result.code).toBe('unknown');
    expect(result.needsReauth).toBe(false);
  });

  it('reads message fields from non-Error thrown objects', () => {
    const result = classifyBrowserAutomationError({
      message: 'Target closed while taking screenshot',
    });

    expect(result.code).toBe('browser_session_lost');
  });
});

describe('classifyBrowserAutomationError detail', () => {
  it('keeps the raw message and stack for an unrecognised error', () => {
    const result = classifyBrowserAutomationError(
      new Error('ECONNRESET while talking to the agent'),
      'action',
    );

    expect(result.code).toBe('unknown');
    expect(result.userFacing).toBe(
      'Browser automation failed for an unknown reason.',
    );
    expect(result.detail).toContain('ECONNRESET while talking to the agent');
    expect(result.detail).toContain('Error:');
    // A stack is what makes an unrecognised failure traceable to a line.
    expect(result.detail).toContain('browser-automation-errors.spec');
  });

  it('keeps the raw error on a recognised classification too', () => {
    const result = classifyBrowserAutomationError(
      new Error('Navigation timed out after 30000ms'),
      'navigation',
    );

    expect(result.code).toBe('timeout');
    expect(result.detail).toContain('Navigation timed out after 30000ms');
  });

  it('handles a non-Error throw', () => {
    const result = classifyBrowserAutomationError(
      { message: 'quota exceeded for this project' },
      'session',
    );

    expect(result.detail).toContain('quota exceeded for this project');
  });

  it('truncates a runaway error rather than storing it whole', () => {
    const result = classifyBrowserAutomationError(new Error('x'.repeat(9000)));

    expect(result.detail).toMatch(/… \(truncated\)$/);
    expect(result.detail!.length).toBeLessThan(4100);
  });
});
