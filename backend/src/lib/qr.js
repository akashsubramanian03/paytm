/**
 * Paytm pay codes. The QR shown on a profile encodes this string; the
 * "scan & pay" screen accepts either the full string or a bare UPI ID /
 * mobile number / email typed in by hand.
 */
export function buildPayPayload(user) {
  const params = new URLSearchParams({
    vpa: user.upiId,
    pn: `${user.firstName} ${user.lastName}`.trim(),
    uid: user.id,
  });
  return `paytm://pay?${params.toString()}`;
}

/** Extracts a lookup identifier from a scanned/pasted code. */
export function parsePayPayload(raw) {
  const code = String(raw).trim();

  if (/^(paytm|upi):\/\//i.test(code)) {
    const query = code.slice(code.indexOf('?') + 1);
    const params = new URLSearchParams(code.includes('?') ? query : '');
    const vpa = params.get('vpa') || params.get('pa');
    const uid = params.get('uid');
    if (uid) return { kind: 'id', value: uid };
    if (vpa) return { kind: 'upi', value: vpa.toLowerCase() };
    return null;
  }

  if (/^[a-z0-9.\-_]{3,32}@[a-z]{3,16}$/i.test(code) && !code.includes('.com')) {
    return { kind: 'upi', value: code.toLowerCase() };
  }
  if (/^[6-9]\d{9}$/.test(code)) return { kind: 'phone', value: code };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(code)) return { kind: 'email', value: code.toLowerCase() };
  if (/^c[a-z0-9]{20,}$/i.test(code)) return { kind: 'id', value: code };
  return null;
}
