function parseOffsetMinutes(value = '+03:30') {
  const match = String(value).trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 210;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function parseScheduleInput(value, offsetMinutes = 210) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, y, mo, d, h, mi] = match;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - offsetMinutes * 60_000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;

  // Reject impossible dates such as 2026-02-31.
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  if (
    local.getUTCFullYear() !== Number(y) ||
    local.getUTCMonth() !== Number(mo) - 1 ||
    local.getUTCDate() !== Number(d) ||
    local.getUTCHours() !== Number(h) ||
    local.getUTCMinutes() !== Number(mi)
  ) return null;

  return date;
}

function formatScheduledAt(date, offsetMinutes = 210) {
  if (!date) return '-';
  const local = new Date(new Date(date).getTime() + offsetMinutes * 60_000);
  const pad = n => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

module.exports = { parseOffsetMinutes, parseScheduleInput, formatScheduledAt };
