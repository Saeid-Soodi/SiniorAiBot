function normalizeTelegramUrl(value, fallbackUsername = '') {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw) || /^tg:\/\//i.test(raw)) return raw;

  const username = String(raw || fallbackUsername || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/t\.me\//i, '')
    .split(/[/?#]/)[0];

  return username ? `https://t.me/${username}` : null;
}

function telegramErrorDetails(error) {
  return {
    name: error?.name || null,
    message: error?.message || null,
    errorCode: error?.response?.error_code || null,
    description: error?.response?.description || null,
    method: error?.on?.method || null
  };
}

module.exports = { normalizeTelegramUrl, telegramErrorDetails };
