/**
 * Test-only in-memory Storage stub. The vitest jsdom env exposes no
 * localStorage (opaque-origin window), so tests that exercise the
 * CYJ-14 durable-storage paths stub a deterministic in-memory Storage
 * via vi.stubGlobal. Shared by oauthState.test.ts, Landing.test.tsx,
 * and AuthCallback.test.tsx — one copy so the three cannot drift apart.
 * Never imported by app code.
 */

export function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}
