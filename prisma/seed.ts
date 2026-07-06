import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_RETENTION_POLICIES } from "../src/lib/retention";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// 台灣 22 縣市（sortOrder 依慣用北到南、離島最後）
const CITIES: Array<[string, string]> = [
  ["台北市", "taipei-city"],
  ["新北市", "new-taipei-city"],
  ["基隆市", "keelung-city"],
  ["桃園市", "taoyuan-city"],
  ["新竹市", "hsinchu-city"],
  ["新竹縣", "hsinchu-county"],
  ["苗栗縣", "miaoli-county"],
  ["台中市", "taichung-city"],
  ["彰化縣", "changhua-county"],
  ["南投縣", "nantou-county"],
  ["雲林縣", "yunlin-county"],
  ["嘉義市", "chiayi-city"],
  ["嘉義縣", "chiayi-county"],
  ["台南市", "tainan-city"],
  ["高雄市", "kaohsiung-city"],
  ["屏東縣", "pingtung-county"],
  ["宜蘭縣", "yilan-county"],
  ["花蓮縣", "hualien-county"],
  ["台東縣", "taitung-county"],
  ["澎湖縣", "penghu-county"],
  ["金門縣", "kinmen-county"],
  ["連江縣", "lienchiang-county"],
];

const CATEGORIES: Array<[string, string]> = [
  ["食品雜貨", "groceries"],
  ["優惠票券", "coupons"],
  ["居家生活", "home-living"],
  ["服飾配件", "apparel"],
  ["母嬰童書", "kids-books"],
  ["3C 家電", "electronics"],
  ["文具玩具", "stationery-toys"],
  ["寵物用品", "pets"],
  ["其他", "others"],
  // M9 好康資訊與券票點強化（master-plan.md §9a 共通設計決策）：票券／點數沿用既有
  // category slug 模式判別內容類型，不加 items.type 欄位。
  ["電子票券", "tickets"],
  ["點數好康", "points"],
];

// M9 §9a 交付內容 3／4／5：keyword_blocklist 詞庫（idempotent upsert，四組詞條）。
// 加價詞：防止券票類「無償轉贈」變相收費（研究 04 禁句清單）。
const KEYWORD_BLOCKLIST_MARKUP: string[] = ["+300", "小補", "私訊出價", "補差價", "加價"];
// 折現詞：防止點數/券類「折現/換現金/交換」變相金流（§1 non-goals：不做金流、不做交換）。
const KEYWORD_BLOCKLIST_CASH_OUT: string[] = ["折現", "換現金", "交換", "面交補"];
// 不可上架券名：官方明文禁轉贈/官方閉環類型（LINE 即享券/禮物、7-ELEVEN 行動隨時取、
// 全家隨買跨店取），攔截層二負責擋自由文字（描述、留言），攔截層一（表單/API 常數清單）
// 另有獨立實作，不在本表範圍。
const KEYWORD_BLOCKLIST_NON_TRANSFERABLE: string[] = [
  "即享券",
  "LINE 禮物",
  "隨買跨店取",
  "行動隨時取",
];
// 個資徵求詞：點數類型個資最小化（硬規則），固定詞攔截；手機號格式另由獨立正則 helper 處理
// （非本表範圍，見 §9a 交付內容 5）。
const KEYWORD_BLOCKLIST_PII: string[] = ["驗證碼", "會員帳號", "OTP"];

const KEYWORD_BLOCKLIST_SEED: string[] = [
  ...KEYWORD_BLOCKLIST_MARKUP,
  ...KEYWORD_BLOCKLIST_CASH_OUT,
  ...KEYWORD_BLOCKLIST_NON_TRANSFERABLE,
  ...KEYWORD_BLOCKLIST_PII,
];

// M9 交付內容 2：方案 B 的 10 個 S1 官方來源種子（研究 03 選定 #1,3,4,5,6,7,9,10,12,13）。
// URL 為研究文件記錄之官方頁；收錄前仍需編輯人工再核現況（見 §9a「實作前查證清單」）。
// 一律 sourceGrade="S1"；notes 記錄收錄注意事項，高優先兩則（友善食光／i珍食）標明理由。
const DEAL_SOURCES_SEED: Array<{
  name: string;
  officialUrl: string;
  notes?: string;
}> = [
  {
    name: "麥當勞台灣官網「現正推出」",
    officialUrl: "https://www.mcdonalds.com/tw/zh-tw/whats-hot.html",
    notes: "官方 ToS 明文禁止複製散佈，僅能自寫摘要＋連結導流，不可轉貼官方圖文。",
  },
  {
    name: "肯德基台灣",
    officialUrl: "https://www.kfcclub.com.tw/coupon",
    notes: "JS SPA，不適合自動抓取；官方條款禁拷貝重製，僅導流＋人工摘要，不收錄優惠代碼。",
  },
  {
    name: "摩斯漢堡",
    officialUrl: "https://www.mos.com.tw/",
    notes: "網站對非瀏覽器 UA 有阻擋措施，只適合人工瀏覽收錄。",
  },
  {
    name: "漢堡王台灣",
    officialUrl: "https://www.burgerking.com.tw/coupon",
    notes: "JS SPA，人工摘要＋導流，不轉貼券圖。",
  },
  {
    name: "全家便利商店活動頁",
    officialUrl: "https://www.family.com.tw/Marketing/zh/Event",
    notes: "活動網址常為短期性質，收錄時記錄原始網址與查閱日期。",
  },
  {
    name: "全家「友善食光」說明頁",
    officialUrl: "https://nevent.family.com.tw/cherishfood/",
    notes: "高優先：機制說明頁為公開靜態內容，與惜食定位最契合；即時庫存僅在 App 內，不收錄。",
  },
  {
    name: "7-ELEVEN 官網活動頁",
    officialUrl: "https://www.7-11.com.tw/special/newsList.aspx",
    notes: "列表連結靠 JS 產生，人工收錄＋導流固定 URL。",
  },
  {
    name: "7-ELEVEN「i珍食」說明頁",
    officialUrl: "https://www.7-11.com.tw/event/lovefood/index.aspx",
    notes: "高優先：機制說明頁為公開靜態內容；即時庫存地圖在 OPEN POINT App 內，不收錄。",
  },
  {
    name: "全聯福利中心",
    officialUrl: "https://www.pxmart.com.tw/campaign/latest",
    notes: "Next.js SPA，人工收錄檔期摘要＋導流。",
  },
  {
    name: "萬家福",
    officialUrl: "https://www.uni-prosperity.com.tw/catalogues/",
    notes: "原「家樂福」，官方已更名並 301 至此網域，文案一律用新名「萬家福」。",
  },
];

async function main() {
  for (const [i, [name, slug]] of CITIES.entries()) {
    await prisma.city.upsert({
      where: { slug },
      update: { name, sortOrder: i },
      create: { name, slug, sortOrder: i },
    });
  }

  for (const [i, [name, slug]] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug },
      update: { name, sortOrder: i },
      create: { name, slug, sortOrder: i },
    });
  }

  // 注意：不在這裡預建 ADMIN_EMAIL 的 User——沒有 OAuth 連結的預建列會讓 Auth.js
  // 回 OAuthAccountNotLinked 擋掉登入。admin 角色改由 src/auth.ts 的 signIn event
  // 在首次登入時自動授予。

  // M7 資料保留政策初始值（master-plan §7a 交付內容 4）：只在資料庫沒有這個 policyKey
  // 時才建立，已存在就不覆蓋（後台可能已經被 admin 調整過，不希望重跑 seed 蓋掉設定）。
  for (const policy of DEFAULT_RETENTION_POLICIES) {
    await prisma.dataRetentionPolicy.upsert({
      where: { policyKey: policy.policyKey },
      update: {},
      create: {
        policyKey: policy.policyKey,
        description: policy.description,
        retentionDays: policy.retentionDays,
        action: policy.action,
      },
    });
  }

  // M9 交付內容 3：keyword_blocklist 詞庫 idempotent upsert（keyword 欄位本身已是
  // @unique，重複執行不會重複建立；isActive 交給後台 CRUD 頁管理，這裡不覆蓋）。
  for (const keyword of KEYWORD_BLOCKLIST_SEED) {
    await prisma.keywordBlocklist.upsert({
      where: { keyword },
      update: {},
      create: { keyword },
    });
  }

  // M9 交付內容 2：deal_sources 的 10 個 S1 種子來源。§11.2 未替 deal_sources 定案任何
  // unique 索引（後台本來就允許 moderator/admin 手動增修來源），因此 idempotent 判斷
  // 改用 officialUrl 做應用層查找：找不到才 create；已存在只刷新 name/notes 對齊研究文件
  // 最新內容，刻意不覆蓋 lastCheckedAt/isActive——避免蓋掉後台「標記已查證」等既有調整。
  for (const source of DEAL_SOURCES_SEED) {
    const existing = await prisma.dealSource.findFirst({
      where: { officialUrl: source.officialUrl },
      select: { id: true },
    });
    if (existing) {
      await prisma.dealSource.update({
        where: { id: existing.id },
        data: { name: source.name, notes: source.notes ?? null },
      });
    } else {
      await prisma.dealSource.create({
        data: {
          name: source.name,
          officialUrl: source.officialUrl,
          sourceGrade: "S1",
          notes: source.notes ?? null,
          lastCheckedAt: new Date(),
        },
      });
    }
  }

  const [cities, categories, retentionPolicies, keywordBlocklistEntries, dealSources] =
    await Promise.all([
      prisma.city.count(),
      prisma.category.count(),
      prisma.dataRetentionPolicy.count(),
      prisma.keywordBlocklist.count(),
      prisma.dealSource.count(),
    ]);
  console.log(
    `Seed 完成：${cities} 縣市、${categories} 分類、${retentionPolicies} 筆資料保留政策、` +
      `${keywordBlocklistEntries} 筆關鍵字黑名單、${dealSources} 個好康來源`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
