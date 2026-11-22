const configuredBase = process.env.NEXT_PUBLIC_API_URL || '';

export function getApiBaseUrl() {
  // Prefer same-origin /api proxy (works for remote access without exposing port 4000)
  if (!configuredBase || configuredBase === 'same-origin') return '';
  if (typeof window !== 'undefined') {
    const pageHost = window.location.hostname;
    if ((configuredBase.includes('localhost') || configuredBase.includes('127.0.0.1')) && pageHost && pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
      // fallback: if proxy not desired, try direct host:4000
      return `${window.location.protocol}//${pageHost}:4000`;
    }
  }
  return configuredBase;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const base = getApiBaseUrl();
  const res = await fetch(`${base}${path}`, { ...init, headers, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.message || `Request failed: ${res.status}`);
  }
  return data as T;
}

/** Authenticated file download. Borrower links cannot carry the Bearer token,
 *  so fetch the bytes with the current session and hand them to the browser. */
export async function downloadAuthenticatedFile(path: string, filename: string, token?: string | null): Promise<void> {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers, cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any)?.message || `Download failed: ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
