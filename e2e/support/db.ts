// 測試用的共用 Prisma client：直接重用 src/lib/db.ts 已經設定好的 adapter/連線，
// 避免測試碼另外重建一份連線設定跟正式程式碼分岔。
export { db } from "../../src/lib/db";
