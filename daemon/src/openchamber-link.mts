export function openChamberMiniChatUrl(base: string, sessionId: string): string | null {
  const id = sessionId.trim();
  if (!/^ses_[A-Za-z0-9_-]+$/.test(id)) return null;
  const target = new URL('/mini-chat.html', base);
  target.searchParams.set('mode', 'session');
  target.searchParams.set('sessionId', id);
  return target.toString();
}
