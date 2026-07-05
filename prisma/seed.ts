import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

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

  // admin 綁定：ADMIN_EMAIL 的帳號首次以 Google 登入後即具 admin 角色
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail },
    });
    await prisma.userRole.upsert({
      where: { userId_role: { userId: user.id, role: "admin" } },
      update: {},
      create: { userId: user.id, role: "admin" },
    });
  }

  const [cities, categories] = await Promise.all([
    prisma.city.count(),
    prisma.category.count(),
  ]);
  console.log(`Seed 完成：${cities} 縣市、${categories} 分類${adminEmail ? "、admin 已綁定" : ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
