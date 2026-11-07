export async function fetchOpenChamberMiniChatUrl(sessionId: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/api/openchamber/mini-chat?sessionId=${encodeURIComponent(sessionId)}`, {
    cache: 'no-store',
    signal,
  });
  const body = await res.json().catch(() => ({})) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `OpenChamber indisponible (${res.status})`);
  return body.url;
}
