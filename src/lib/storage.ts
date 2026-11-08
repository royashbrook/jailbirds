// local state only. a blocked or full store (private mode, a strict browser)
// must never stop a kid playing: reads fall back to nothing, writes report
// whether they stuck so the screen can say "not saving" instead of lying.
export function readSlot(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeSlot(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readSlot(key)
  if (raw === null) return fallback
  try {
    return { ...fallback, ...JSON.parse(raw) }
  } catch {
    return fallback
  }
}

export const writeJson = (key: string, value: unknown) => writeSlot(key, JSON.stringify(value))
