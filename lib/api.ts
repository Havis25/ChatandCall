// lib/api.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = (
  process.env.EXPO_PUBLIC_API_URL || "https://4af813bf189d.ngrok-free.app"
).replace(/\/+$/, "");

type JSONValue = any;

export async function api<T = JSONValue>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal
): Promise<T> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const token = await AsyncStorage.getItem("access_token");

  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} — ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}
