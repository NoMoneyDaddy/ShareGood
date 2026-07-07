"use client";

import {
  ArrowLeft,
  ArrowRight,
  Gift,
  Handshake,
  LayoutGrid,
  type LucideIcon,
  MessageCircle,
  User,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

// 初次導覽（M11，使用者實測回饋第 5 項：「全站操作流程要簡單、不藏太深，做初次導覽
// （可重新打開）」）。
//
// 設計取捨（自製、零新依賴，替代 driver.js／react-joyride 等第三方 spotlight 套件）：
// 5 個步驟裡有 4 個（逛好物、分享、訊息、我的）對應底部導覽的固定分頁，但底部導覽
// 只在行動版顯示（`bottom-tab.tsx` 的 `md:hidden`），桌面版完全不存在對應 DOM 元素；
// 另外「看到喜歡的留言接手」發生在物品詳情頁的留言區塊，使用者當下不見得在那個頁面。
// 若做成「即時定位到真實 DOM 元素」的 spotlight（例如量測 getBoundingClientRect 挖洞），
// 桌面版與非對應頁面都會找不到錨點元素而整套失效或需要另外設計一套桌面版導覽，複雜度
// 與本專案「輕量」的要求不成比例。這裡改用「置中卡片＋步驟說明＋圖示」的 coachmark
// 樣式（backdrop 半透明遮罩＋卡片本身帶有 spotlight 感的圖示光暈），行動與桌面都是
// 同一套 UI、不依賴任何頁面上的真實元素，符合「行動優先，桌面也要正常」。
//
// 已知取捨（規格明訂可接受）：完成/跳過狀態只存 `localStorage`（key: `tour_done`），
// 換裝置或清除瀏覽器資料會重新看到導覽一次，不做跨裝置同步（不新增資料庫欄位），
// 現階段影響有限。
const STEPS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: LayoutGrid,
    title: "逛逛附近的好物",
    description:
      "底部導覽的「逛好物」可以依縣市、分類或關鍵字，找找看有沒有你需要的東西——完全免費。",
  },
  {
    icon: Handshake,
    title: "看到喜歡的，留言接手",
    description: "物品詳情頁留言就能表達想要，先到先得；有些物品也會用抽籤決定歸屬。",
  },
  {
    icon: Gift,
    title: "把用不到的分享出去",
    description: "點底部中央的「分享」，拍張照、寫幾句話，你的閒置好物就能換一個新家。",
  },
  {
    icon: MessageCircle,
    title: "在訊息裡約交接",
    description: "配對成功後，雙方可以在「訊息」裡聊聊交接時間與地點，完成後互相確認。",
  },
  {
    icon: User,
    title: "「我的」管理你的一切",
    description: "優惠券錢包、訂閱通知、帳號設定都在這裡，隨時可以回來看看。",
  },
];

const STORAGE_KEY = "tour_done";
const RESTART_EVENT = "sharegood:restart-tour";

/** 給 /me 中心頁的「重新看一次導覽」按鈕呼叫：不管 localStorage 旗標，強制重新打開。 */
export function restartOnboardingTour() {
  window.dispatchEvent(new Event(RESTART_EVENT));
}

export function OnboardingTour({ loggedIn }: { loggedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // 登入後首次進站自動顯示：只在 loggedIn 且 localStorage 沒有完成旗標時觸發，
  // 只在掛載時判斷一次（不需要每次 loggedIn 變動都重新檢查，SiteHeader/ShellLayout
  // 已經是登入後才會渲染這個元件所在的殼層）。
  useEffect(() => {
    if (!loggedIn) return;
    if (window.localStorage.getItem(STORAGE_KEY) !== "true") {
      setStepIndex(0);
      setOpen(true);
    }
  }, [loggedIn]);

  // /me 頁「重新看一次導覽」的重新打開入口，見上方 restartOnboardingTour()。
  useEffect(() => {
    function handleRestart() {
      setStepIndex(0);
      setOpen(true);
    }
    window.addEventListener(RESTART_EVENT, handleRestart);
    return () => window.removeEventListener(RESTART_EVENT, handleRestart);
  }, []);

  function finish() {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  }

  // Escape 關閉：用 window 層級的 keydown 監聽而非在遮罩 <div> 上掛
  // onKeyDown/onClick——那樣會被 a11y linter 判定成「靜態元素冒充互動元素」
  // （沒有語意角色卻同時處理滑鼠與鍵盤事件）。背景遮罩改用真正的 <button>
  // （見下方 JSX），鍵盤的 Escape 快捷鍵則獨立處理，兩條路徑互不干擾。
  // 直接在 effect 內寫完整邏輯（而非呼叫外層 `finish`）：避免把每次 render
  // 都重新建立的函式塞進依賴陣列，導致監聽器不必要地重新掛載。
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      window.localStorage.setItem(STORAGE_KEY, "true");
      setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        onClick={finish}
        aria-label="關閉導覽"
        className="absolute inset-0 bg-navy/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新手導覽"
        className="relative w-full max-w-sm rounded-2xl border border-line bg-card p-6 text-center shadow-lg"
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={finish}
            aria-label="跳過導覽"
            className="-mr-2 -mt-2 flex size-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {/* 圖示光暈：帶一點 spotlight 感，不是真的挖洞在頁面元素上，純裝飾。 */}
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-brand-soft text-brand-ink shadow-brand-glow">
          <Icon size={28} strokeWidth={1.75} aria-hidden="true" />
        </div>

        <h2 className="mt-4 text-lg font-bold tracking-tight text-ink">{step.title}</h2>
        <p className="mt-2 text-sm text-ink-soft">{step.description}</p>

        <div className="mt-5 flex items-center justify-center gap-1.5" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? "w-5 bg-brand" : "w-1.5 bg-line"
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"
          >
            跳過導覽
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => i - 1)}
                aria-label="上一步"
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? finish() : setStepIndex((i) => i + 1))}
              className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground transition hover:bg-brand-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {isLast ? "開始使用" : "下一步"}
              {!isLast && <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
