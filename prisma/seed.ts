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

  const [cities, categories, retentionPolicies] = await Promise.all([
    prisma.city.count(),
    prisma.category.count(),
    prisma.dataRetentionPolicy.count(),
  ]);
  console.log(`Seed 完成：${cities} 縣市、${categories} 分類、${retentionPolicies} 筆資料保留政策`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
