// Shared AdsGram lock, ported from SLY.
// It prevents automatic and rewarded interstitials from overlapping and
// enforces the same 15-second gap between manual rewarded ads.
let globalAdLock = false
let lastAdEndedAt = 0
let lockAcquiredAt = 0

export const MIN_GAP_BETWEEN_ADS_MS = 15000
const ASSUMED_MAX_AD_DURATION_MS = 30000

export function tryAcquireGlobalAdLock(isAuto = false): boolean {
  const now = Date.now()
  if (globalAdLock) return false
  if (!isAuto && lastAdEndedAt > 0 && now - lastAdEndedAt < MIN_GAP_BETWEEN_ADS_MS) return false
  globalAdLock = true
  lockAcquiredAt = now
  return true
}

export function releaseGlobalAdLock(isAuto = false): void {
  globalAdLock = false
  if (!isAuto) lastAdEndedAt = Date.now()
  lockAcquiredAt = 0
}

export function getAdLockWaitSeconds(): number {
  const now = Date.now()
  if (globalAdLock) {
    const remaining = ASSUMED_MAX_AD_DURATION_MS - (now - lockAcquiredAt)
    if (remaining > 0) return Math.max(1, Math.ceil(remaining / 1000))
  }
  if (lastAdEndedAt > 0) {
    const remaining = MIN_GAP_BETWEEN_ADS_MS - (now - lastAdEndedAt)
    if (remaining > 0) return Math.max(1, Math.ceil(remaining / 1000))
  }
  return 0
}

export function isGlobalAdLocked(): boolean {
  return globalAdLock
}
