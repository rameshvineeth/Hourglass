export const isDesktop = () => !!document.querySelector('meta[name="hourglass-session"]');
export async function nativeApi<T>(path: string, body?: unknown): Promise<T> {
  const token = document.querySelector('meta[name="hourglass-session"]')?.getAttribute('content');
  if (!token) throw new Error('Native capture requires the Windows companion. Browser mode supports manual entries.');
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Hourglass-Session': token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
