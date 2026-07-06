import { MapPin, MessageSquare, Search, ShieldCheck, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { auth, signIn } from "@/auth";
import { BottomTab } from "@/components/bottom-tab";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";

// 示範資料：M1 完成後改為查詢 published 物品（本區塊整段替換）
const DEMO_ITEMS = [
  {
    seed: "sharegood-kettle",
    title: "恆溫快煮壺（全新）",
    say: "婚禮回禮多了一個，希望有人接手。",
    district: "大安區",
    time: "2 小時前",
    category: "居家生活",
  },
  {
    seed: "sharegood-books",
    title: "幼兒繪本十二本",
    say: "孩子長大了，換人陪伴。",
    district: "中山區",
    time: "5 小時前",
    category: "母嬰童書",
  },
  {
    seed: "sharegood-coffee",
    title: "咖啡買一送一券兩張",
    say: "下週到期，別浪費。",
    district: "信義區",
    time: "今天",
    category: "優惠票券",
  },
  {
    seed: "sharegood-lamp",
    title: "露營燈（九成新）",
    say: "升級裝備，舊的還很好用。",
    district: "北投區",
    time: "昨天",
    category: "居家生活",
  },
];

// 順序、名稱需與 prisma/seed.ts 的分類清單一致（"全部" 是畫面用的篩選項，非資料庫分類）
const CATEGORIES = [
  "全部",
  "食品雜貨",
  "優惠票券",
  "居家生活",
  "服飾配件",
  "母嬰童書",
  "3C 家電",
  "文具玩具",
  "寵物用品",
  "其他",
];

export default async function HomePage() {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;
  const ctaState = !session?.user ? "guest" : profile ? "active" : "pending";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      <SiteHeader session={session} profile={profile} />

      <main className="flex-1 pb-24 md:pb-0">
        {/* Hero：搜尋為核心 CTA，split 版面 */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-10 sm:px-6 md:grid-cols-12 md:pt-16">
          <div className="md:col-span-7">
            <h1 className="max-w-[14ch] text-4xl font-extrabold leading-[1.15] tracking-tight text-ink md:text-5xl">
              用不到的好物，
              <br />
              交給剛好需要的人
            </h1>
            <p className="mt-4 max-w-[38ch] text-base text-ink-soft md:text-lg">
              台灣縣市級免費共享。不買賣、不交換，留言就有機會接手。
            </p>

            <div className="mt-7 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3.5 shadow-sm has-[:disabled]:cursor-not-allowed">
              <Search
                size={19}
                strokeWidth={2.2}
                aria-hidden="true"
                className="shrink-0 text-ink-soft"
              />
              <Input
                type="search"
                name="q"
                aria-label="搜尋好物、分類或縣市"
                placeholder="搜尋好物、分類或縣市…"
                disabled
                title="M1 起開放搜尋"
                className="h-auto border-none bg-transparent p-0 text-base text-ink shadow-none focus-visible:ring-0 disabled:pointer-events-none disabled:bg-transparent"
              />
              <Button variant="brand" size="xl" className="shrink-0" disabled title="M1 起開放搜尋">
                搜尋
              </Button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {CATEGORIES.slice(1, 6).map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-line bg-card px-3.5 py-1.5 text-sm text-ink-soft"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* 手機版隱藏：split hero 設計是給桌機的左右對照，手機疊成單欄時圖片會把第一屏
              擠得太滿、緊貼底部導覽列看起來像被截斷，索性只在 md 以上顯示 */}
          <div className="relative mx-auto hidden w-full max-w-md md:col-span-5 md:block">
            <div className="overflow-hidden rounded-2xl border border-line shadow-lg">
              <Image
                src="https://picsum.photos/seed/sharegood-hero/720/560"
                alt="鄰居互相交接好物的日常場景"
                width={720}
                height={560}
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* 熱門好物 */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-2xl font-bold tracking-tight">熱門好物</h2>
            <span className="text-sm text-ink-soft">示範資料，M1 起顯示真實好物</span>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
            {DEMO_ITEMS.map((it) => (
              <article
                key={it.seed}
                className="group overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-paper-2">
                  <Image
                    src={`https://picsum.photos/seed/${it.seed}/560/420`}
                    alt={it.title}
                    fill
                    sizes="(min-width: 768px) 25vw, 50vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                  <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-0.5 text-xs font-bold text-white">
                    免費
                  </span>
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1 text-[11px] text-ink-soft">
                    <MapPin size={11} strokeWidth={2.4} aria-hidden="true" />
                    {it.district} ・ {it.time}
                  </div>
                  <h3 className="mt-1 truncate font-semibold leading-snug">{it.title}</h3>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">{it.say}</p>
                  <span className="mt-2 inline-block rounded-md bg-paper-2 px-2 py-0.5 text-[11px] text-ink-soft">
                    {it.category}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 怎麼運作：三步驟，非置中版面 */}
        <section className="border-y border-line bg-paper-2/60">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="max-w-[16ch] text-pretty text-2xl font-bold tracking-tight md:text-3xl">
              三步驟，把好物交給下一個需要的人
            </h2>
            <div className="mt-9 grid gap-8 md:grid-cols-3">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-lg font-extrabold text-brand-ink">
                  1
                </span>
                <h3 className="mt-4 font-bold">上架分享</h3>
                <p className="mt-1.5 max-w-[30ch] text-sm text-ink-soft">
                  拍照上架，寫一句分享的理由，選擇你的縣市。
                </p>
              </div>
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-lg font-extrabold text-brand-ink">
                  2
                </span>
                <h3 className="mt-4 font-bold">留言需要</h3>
                <p className="mt-1.5 max-w-[30ch] text-sm text-ink-soft">
                  需要的人留言，分享者從中挑選，也能直接贈與。
                </p>
              </div>
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-lg font-extrabold text-brand-ink">
                  3
                </span>
                <h3 className="mt-4 font-bold">私訊交接</h3>
                <p className="mt-1.5 max-w-[30ch] text-sm text-ink-soft">
                  站內私訊約定時間地點，完成後互相感謝。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 信任與安全：橫向條款列，刻意不用三步驟那種卡片版型，避免版面重複 */}
        <section className="border-y border-line bg-paper-2/40">
          <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
            <ul className="flex flex-col divide-y divide-line sm:flex-row sm:divide-x sm:divide-y-0">
              <li className="flex items-start gap-2.5 py-4 first:pt-0 sm:flex-1 sm:px-6 sm:py-0 sm:first:pl-0 sm:last:pr-0">
                <ShieldCheck
                  size={18}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-brand"
                />
                <p className="text-sm text-ink-soft">
                  <strong className="font-bold text-ink">絕不收費。</strong>
                  平台上所有物品一律免費，任何收費都違反規範，可以檢舉。
                </p>
              </li>
              <li className="flex items-start gap-2.5 py-4 first:pt-0 sm:flex-1 sm:px-6 sm:py-0 sm:first:pl-0 sm:last:pr-0">
                <MessageSquare
                  size={18}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-brand"
                />
                <p className="text-sm text-ink-soft">
                  <strong className="font-bold text-ink">私訊才開放。</strong>
                  交接成立後才開啟私訊，分享前不需要公開任何聯絡方式。
                </p>
              </li>
              <li className="flex items-start gap-2.5 py-4 first:pt-0 sm:flex-1 sm:px-6 sm:py-0 sm:first:pl-0 sm:last:pr-0">
                <Users
                  size={18}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-brand"
                />
                <p className="text-sm text-ink-soft">
                  <strong className="font-bold text-ink">分享者做主。</strong>
                  誰來接手由分享者親自挑選，不是先搶先贏的戰場。
                </p>
              </li>
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-navy">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-5 px-4 py-12 sm:px-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-bold text-white">把用不到的好物，分享出去</h2>
              <p className="mt-1.5 text-sm text-white/70">
                {ctaState === "active"
                  ? "拍張照，寫一句分享的理由，馬上就能上架。"
                  : ctaState === "pending"
                    ? "只差最後一步，設定暱稱與縣市就能開始分享。"
                    : "登入只需要一個 Google 帳號，設定暱稱與縣市就能開始。"}
              </p>
            </div>
            {ctaState === "active" ? (
              <Button asChild variant="brand" size="xl">
                <Link href="/items/new">我要分享</Link>
              </Button>
            ) : ctaState === "pending" ? (
              <Button asChild variant="brand" size="xl">
                <Link href="/onboarding">完成設定</Link>
              </Button>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await signIn("google");
                }}
              >
                <Button type="submit" variant="brand" size="xl">
                  加入 ShareGood
                </Button>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper-2 pb-24 md:pb-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-soft sm:px-6 md:flex-row md:items-center md:justify-between">
          <span className="font-bold text-ink">好物共享 ShareGood</span>
          <span>台灣縣市級免費共享平台。使用規範、服務條款、隱私權政策準備中。</span>
        </div>
      </footer>

      <BottomTab />
    </div>
  );
}
