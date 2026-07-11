function formatToman(value) {
  return `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
}

function formatDateTime(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(date);
  } catch (_) {
    return new Date(date).toLocaleString('fa-IR');
  }
}

function makePaymentCode(id) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `PAY-${stamp}-${String(id).slice(-6).toUpperCase()}`;
}

module.exports = { formatToman, formatDateTime, makePaymentCode };
