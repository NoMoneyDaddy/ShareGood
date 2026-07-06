import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { mergeWithDefaults } from "@/lib/notification-preferences";
import { cn } from "@/lib/utils";
import { PreferenceToggle } from "./preference-toggle";

export const metadata: Metadata = { title: "通知偏好設定" };

// 通知偏好設定頁（master-plan §9）：每類事件各自控制「站內」「外部」兩個開關。
// 外部通知目前僅 Telegram（M4）；「哪個外部管道」的綁定細節不在這支頁面處理。
export default async function NotificationPreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const rows = await db.notificationPreference.findMany({
    where: { userId: session.user.id },
    select: { eventType: true, inAppEnabled: true, externalEnabled: true },
  });
  const preferences = mergeWithDefaults(rows);

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">通知偏好設定</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        選擇每一類事件要不要收站內通知，以及要不要額外收 Telegram 等外部通知。
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line bg-paper-2 px-4 py-2.5 text-xs font-medium text-ink-soft">
          <span>事件</span>
          <span className="text-center">站內</span>
          <span className="text-center">外部</span>
        </div>
        <ul>
          {preferences.map((pref, index) => (
            <li
              key={pref.eventType}
              className={cn(
                "grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3.5",
                index > 0 && "border-t border-line",
              )}
            >
              <span className="text-sm text-ink">{pref.label}</span>
              <div className="flex justify-center">
                <PreferenceToggle
                  eventType={pref.eventType}
                  channel="inApp"
                  initialEnabled={pref.inAppEnabled}
                  label={`${pref.label}：站內通知`}
                />
              </div>
              <div className="flex justify-center">
                <PreferenceToggle
                  eventType={pref.eventType}
                  channel="external"
                  initialEnabled={pref.externalEnabled}
                  label={`${pref.label}：外部通知`}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-4 text-xs text-ink-soft">
        外部通知目前僅支援 Telegram，綁定入口將於 Telegram 通知功能上線後提供。
      </p>
    </main>
  );
}
