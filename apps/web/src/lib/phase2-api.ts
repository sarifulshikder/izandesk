import { apiFetch } from './api';

export type ApiList<T> = { data: T[]; total?: number; page?: number; limit?: number };

export function getList<T>(path: string, token: string | null) {
  return apiFetch<ApiList<T> | { data: T[] }>(path, {}, token);
}

export function createItem<T>(path: string, body: any, token: string | null) {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }, token);
}
export function updateItem<T>(path: string, body: any, token: string | null) {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }, token);
}
export function deleteItem(path: string, token: string | null) {
  return apiFetch<{ ok: boolean }>(path, { method: 'DELETE' }, token);
}

export async function uploadKyc(subscriberId: string, file: File, docType: string, token: string | null) {
  const form = new FormData();
  form.append('file', file);
  form.append('doc_type', docType);
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${(await import('./api')).getApiBaseUrl()}/api/subscribers/${subscriberId}/kyc`, { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Upload failed');
  return data;
}
