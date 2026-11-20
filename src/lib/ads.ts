// إعلانات المكافآت عبر AdsGram (interstitial عادي int-xxx).
//
// ما نشترط ضغط على الإعلان. الشرط الوحيد: المستخدم يشوف الإعلان 5 ثواني
// على الأقل (من بداية الإعلان onStart لين يتسكر). إذا سكّره قبل هيك
// نرمي RewardAdError("too_short").
//
// الملف هذا ما يمنح شي بنفسه، بس يرجع { awayMs } (مدة المشاهدة بالمللي ثانية)
// أو يرمي RewardAdError. المكافأة يمنحها السيرفر (ad_pulse_confirm).

import { tryAcquireGlobalAdLock, releaseGlobalAdLock, getAdLockWaitSeconds, isGlobalAdLocked } from "./adLock";

// أقل مدة مشاهدة للإعلان حتى تنحسب المكافأة
export const REWARD_MIN_WATCH_MS = 5000;
// أقصى مدة ننتظر فيها الإعلان لين يتسكر
const REWARD_AD_MAX_WAIT_MS = 180000;
// إذا الإعلان ما بدأ خلال هالمدة نعتبره no_fill
const REWARD_AD_START_TIMEOUT_MS = 15000;
// أقصى مدة نبقي القفل بعد ما ينتهي الإعلان إذا show() ما رجع (احتياط)
const REWARD_AD_LOCK_MAX_HOLD_MS = 60000;

// حدث يرسله هذا الملف بعد ما ينعرض إعلان reward، يستخدمه App.tsx
// لجدولة الإعلان التلقائي بعد 10 ثواني من إعلان المكافأة.
export const REWARD_AD_FINISHED_EVENT = "easygram:manual-ad-finished";

// حدث إظهار الرسالة (RewardAdNotice يستمع له)
export const REWARD_AD_NOTICE_EVENT = "easygram:reward-ad-notice";

export type RewardAdErrorCode =
  | "not_ready"
  | "busy"
  | "no_fill"
  | "too_short"
  | "timeout";

export class RewardAdError extends Error {
  code: RewardAdErrorCode;
  waitSeconds?: number;
  debug?: string;

  constructor(code: RewardAdErrorCode, waitSeconds?: number) {
    super(code);
    this.name = "RewardAdError";
    this.code = code;
    this.waitSeconds = waitSeconds;
  }
}

// أماكن إعلانات المكافآت وبلوك AdsGram (int) الخاص بكل مكان
export type RewardPlacement =
  | "mining_start"
  | "mining_claim"
  | "withdrawal"
  | "task"
  | "exchange"
  | "game_attempt";


type AdsgramShowResult = {
  error?: boolean;
  done?: boolean;
  state?: string;
  description?: string;
};

type AdsgramController = {
  show: () => Promise<AdsgramShowResult>;
  addEventListener?: (event: string, callback: () => void) => void;
  removeEventListener?: (event: string, callback: () => void) => void;
};

type AdsgramApi = {
  init: (opts: { blockId: string }) => AdsgramController;
};


const ADSGRAM_SCRIPT_SRC = "https://sad.adsgram.ai/js/sad.min.js";
let autoAdsBackoffUntil = 0;

async function waitForAdsgram(): Promise<AdsgramApi> {
  if (getAdsgram()) return getAdsgram()!;
  let script = document.querySelector<HTMLScriptElement>(`script[src="${ADSGRAM_SCRIPT_SRC}"]`);
  if (!script) {
    script = document.createElement("script");
    script.src = ADSGRAM_SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  }
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const api = getAdsgram();
    if (api) return api;
    await sleep(150);
  }
  throw new RewardAdError("not_ready");
}

export async function prepareEasyGramAd(blockId: string): Promise<void> {
  if (!/^int-\d+$/.test(String(blockId || "").trim())) throw new Error("Invalid AdsGram INT block ID.");
  const cached = controllers.get(blockId.trim());
  if (cached) return;
  const api = await waitForAdsgram();
  const controller = api.init({ blockId: blockId.trim() });
  if (!controller || typeof controller.show !== "function") throw new Error("AdsGram returned an invalid controller.");
  controllers.set(blockId.trim(), controller);
}

export function canShowAutomaticAd(): boolean {
  return Date.now() >= autoAdsBackoffUntil && !isGlobalAdLocked();
}

/** Automatic impressions share SLY's global lock but never grant a reward. */
export async function showEasyGramAd(blockId: string, isAutomatic = true): Promise<boolean> {
  const controller = getController(blockId);
  if (!controller) throw new RewardAdError("not_ready");
  if (!tryAcquireGlobalAdLock(isAutomatic)) throw new RewardAdError("busy", getAdLockWaitSeconds());

  let shown = false;
  const listeners: Array<[string, () => void]> = [];
  const on = (event: string, callback: () => void) => {
    controller.addEventListener?.(event, callback);
    listeners.push([event, callback]);
  };
  let rejectFailure: (error: Error) => void = () => {};
  const failurePromise = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  failurePromise.catch(() => undefined);
  on("onStart", () => { shown = true; });
  on("onBannerNotFound", () => rejectFailure(new Error("No AdsGram ad is available right now.")));
  on("onError", () => rejectFailure(new Error("AdsGram could not load the ad.")));
  on("onNonStopShow", () => {
    autoAdsBackoffUntil = Date.now() + 60000;
    rejectFailure(new Error("AdsGram asked to slow down automatic ads."));
  });
  let showPromise: Promise<unknown>;
  try {
    // Call AdsGram synchronously before the first await.
    showPromise = Promise.resolve(controller.show());
    const result = await Promise.race([
      showPromise,
      failurePromise,
      sleep(180000).then(() => { throw new Error("AdsGram ad timed out."); }),
    ]);
    if ((result as AdsgramShowResult | undefined)?.error) throw new Error((result as AdsgramShowResult).description || "AdsGram ad failed.");
    return shown;
  } finally {
    for (const [event, callback] of listeners) {
      try { controller.removeEventListener?.(event, callback); } catch { /* no-op */ }
    }
    releaseGlobalAdLock(isAutomatic);
  }
}

function getAdsgram(): AdsgramApi | null {
  const a = (window as any).Adsgram as AdsgramApi | undefined;
  return a && typeof a.init === "function" ? a : null;
}

export function isRewardAdReady(): boolean {
  return getAdsgram() !== null;
}

// نفس blockId يرجّع نفس الـController (حسب توثيق AdsGram)
const controllers = new Map<string, AdsgramController>();
function getController(blockId: string): AdsgramController | null {
  if (!/^int-\d+$/.test(String(blockId || "").trim())) return null;
  const normalizedBlockId = String(blockId || "").trim();
  const existing = controllers.get(normalizedBlockId);
  if (existing) return existing;
  const api = getAdsgram();
  if (!api) return null;
  const controller = api.init({ blockId: normalizedBlockId });
  controllers.set(normalizedBlockId, controller);
  return controller;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * يعرض إعلان مكافأة (AdsGram interstitial). يجب استدعاؤه مباشرة من ضغطة
 * المستخدم. كل أماكن الإعلانات، بما فيها السحب، تعتمد على مشاهدة الإعلان
 * لمدة 5 ثوانٍ على الأقل؛ لا نطلب الضغط على الإعلان أو فتح رابطه.
 */
export async function showRewardAdWithPulse(
  blockId: string,
  _placement: RewardPlacement
): Promise<{ awayMs: number; pulseAway: boolean }> {
  // The controller is preloaded while the app is idle. Do not await network
  // or SDK initialization before show(): Telegram needs the original tap.
  const controller = getController(blockId);
  if (!controller) throw new RewardAdError("not_ready");

  if (!tryAcquireGlobalAdLock()) {
    throw new RewardAdError("busy", getAdLockWaitSeconds());
  }

  let shown = false;
  let startedAtTs = 0;
  let closedAtTs = 0;
  let failure: RewardAdError | null = null;
  let watchedMs = 0;
  let showPromiseRef: Promise<void> | null = null;
  let lockReleased = false;

  // Release the lock when the ad actually closes, so automatic ads cannot
  // appear on top of a rewarded ad.
  const finalizeAd = () => {
    if (lockReleased) return;
    lockReleased = true;
    releaseGlobalAdLock();
    if (shown) {
      try {
        window.dispatchEvent(new CustomEvent(REWARD_AD_FINISHED_EVENT));
      } catch {
        /* ignore */
      }
    }
  };

  const listeners: Array<[string, () => void]> = [];
  const on = (event: string, cb: () => void) => {
    controller.addEventListener?.(event, cb);
    listeners.push([event, cb]);
  };

  try {
    let resolveStarted: (ok: boolean) => void = () => {};
    const startedPromise = new Promise<boolean>((resolve) => {
      resolveStarted = resolve;
    });

    on("onStart", () => {
      shown = true;
      startedAtTs = Date.now();
      resolveStarted(true);
    });
    on("onBannerNotFound", () => resolveStarted(false));
    on("onError", () => resolveStarted(false));
    on("onNonStopShow", () => resolveStarted(false));

    // AdsGram's show() resolves when the ad closes (completed or skipped).
    const showPromise: Promise<void> = controller
      .show()
      .then(
        () => {},
        () => {}
      )
      .then(() => {
        closedAtTs = closedAtTs || Date.now();
        resolveStarted(false); // If it never started, treat it as no fill.
      });
    showPromiseRef = showPromise;

    const started = await Promise.race([startedPromise, sleep(REWARD_AD_START_TIMEOUT_MS).then(() => false)]);

    if (!started) {
      failure = new RewardAdError("no_fill");
    } else {
      await Promise.race([showPromise, sleep(REWARD_AD_MAX_WAIT_MS)]);
      if (!closedAtTs) {
        failure = new RewardAdError("timeout");
      } else {
        watchedMs = closedAtTs - (startedAtTs || closedAtTs);
        if (watchedMs < REWARD_MIN_WATCH_MS) failure = new RewardAdError("too_short");
      }
    }
  } finally {
    if (showPromiseRef) {
      showPromiseRef.then(finalizeAd, finalizeAd);
      window.setTimeout(finalizeAd, failure?.code === "no_fill" ? 5000 : REWARD_AD_LOCK_MAX_HOLD_MS);
    } else {
      finalizeAd();
    }
    for (const [event, cb] of listeners) {
      try {
        controller.removeEventListener?.(event, cb);
      } catch {
        /* ignore */
      }
    }
  }

  if (failure) throw failure;
  // pulseAway remains in the API payload for compatibility with deployed RPCs.
  return { awayMs: watchedMs, pulseAway: false };
}

/** يحوّل أي خطأ إعلان لرسالة مترجمة. */
export function rewardAdErrorMessage(
  err: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string
): string | null {
  if (!(err instanceof RewardAdError)) return null;
  switch (err.code) {
    case "not_ready":
      return t("rewardAd.notReady");
    case "busy":
      return err.waitSeconds
        ? t("rewardAd.pleaseWaitSeconds", { seconds: err.waitSeconds })
        : t("rewardAd.busy");
    case "no_fill":
      return t("rewardAd.noFill");
    case "too_short":
      return t("rewardAd.tooShort");
    case "timeout":
      return t("rewardAd.timeout");
  }
}

/**
 * إذا الخطأ RewardAdError يعرض رسالة ثابتة (ما تروح لين المستخدم
 * يضغط عليها) ويرجع true. غير هيك يرجع false والمستدعي يتعامل معه.
 */
export function notifyRewardAdError(
  err: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string
): boolean {
  if (!(err instanceof RewardAdError)) return false;
  const message = rewardAdErrorMessage(err, t);
  if (!message) return false;

  const titleKey = err.code === "busy" ? "rewardAd.titleWait" : "rewardAd.titleError";

  try {
    window.dispatchEvent(
      new CustomEvent(REWARD_AD_NOTICE_EVENT, {
        detail: { code: err.code, title: t(titleKey), message, debug: err.debug },
      })
    );
  } catch {
    return false;
  }
  return true;
}
