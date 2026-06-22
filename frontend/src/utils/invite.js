export function extractInviteCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    if (raw.includes('://')) {
      const url = new URL(raw);
      const match = url.pathname.match(/\/(?:invite|join)\/([^/?#]+)/i);
      return match ? decodeURIComponent(match[1]) : raw;
    }
  } catch {
    // fall through
  }
  const directMatch = raw.match(/^(?:\/+)?(?:invite|join)\/([^/?#]+)/i);
  if (directMatch) return decodeURIComponent(directMatch[1]);
  return raw.replace(/^\/+/, '');
}
