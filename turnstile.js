async function verifyTurnstile(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false, error: 'Missing turnstile token' };

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: remoteip || ''
  });

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const result = await response.json();
  if (!result.success) {
    return { ok: false, skipped: false, error: 'Turnstile verification failed', details: result['error-codes'] || [] };
  }

  return { ok: true, skipped: false };
}

module.exports = {
  verifyTurnstile
};
