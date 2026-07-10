"use client";

import { useCallback, useEffect, useState } from "react";

// 「加到主畫面」共用邏輯（獨立主畫面圖示衍生任務）：`pwa-install-prompt.tsx`（全站
// 橫幅）與 `/me` 中心頁的固定入口卡片都需要同一套平台偵測／安裝狀態，抽成 hook
// 避免兩處各自重寫一份判斷邏輯。
//
// 兩個元件各自呼叫這個 hook 會各自掛一份 `beforeinstallprompt`／`appinstalled`
// 監聽器：瀏覽器對同一個分頁只會派發一次 `beforeinstallprompt` 事件，兩份監聽器
// 收到的是同一個事件物件參考，各自存起來互不影響，不需要做成跨元件共享的單例。

type InstallOutcome = "accepted" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallOutcome }>;
}

export type PwaPlatform = "android" | "ios" | "other";

function detectPlatform(): PwaPlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // iPadOS 13+ 預設 UA 偽裝成 macOS Safari，用觸控點數輔助判斷；不完美但足夠這裡
  // 「要不要顯示 iOS 專屬圖解」的判斷用途。
  const isIosUa =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Macintosh") && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1);
  if (isIosUa) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
}

export function usePwaInstall() {
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<PwaPlatform>("other");
  const [standalone, setStandalone] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setMounted(true);
    setPlatform(detectPlatform());
    setStandalone(detectStandalone());

    function handleBeforeInstallPrompt(event: Event) {
      // 攔下瀏覽器內建的安裝提示，改用我們自己的橫幅／卡片觸發時機。
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      setJustInstalled(true);
      setDeferredPrompt(null);
      window.localStorage.setItem("pwa_prompt_dismissed", "true");
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome | null> => {
    if (!deferredPrompt) return null;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === "accepted") {
      window.localStorage.setItem("pwa_prompt_dismissed", "true");
    }
    return outcome;
  }, [deferredPrompt]);

  return {
    /** SSR／hydration 前一律 false，避免任何依賴瀏覽器 API 的判斷提早出現。 */
    mounted,
    platform,
    /** 已經是「加到主畫面」開啟的獨立模式，或本次工作階段剛安裝完成。 */
    isStandalone: standalone || justInstalled,
    /** Android/Chrome 等支援 `beforeinstallprompt` 的瀏覽器才會是 true。 */
    canPromptInstall: deferredPrompt !== null,
    promptInstall,
  };
}
