import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteObject } from "@/lib/storage";

// 每日清理孤兒檔（master-plan §5）：上傳後 48 小時仍未被任何實體引用的 pending 物件。
// 由外部 cron 以 Authorization: Bearer ${CRON_SECRET} 觸發。
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const orphans = await db.storageObject.findMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    take: 200, // 每次最多清 200 筆，避免單次 request 過長
  });

  let deleted = 0;
  for (const obj of orphans) {
    await deleteObject(obj.objectKey).catch(() => {
      /* MinIO 上已不存在也視為清理成功 */
    });
    await db.storageObject.update({
      where: { id: obj.id },
      data: { status: "deleted", deletedAt: new Date() },
    });
    deleted++;
  }

  return NextResponse.json({ deleted, remaining: orphans.length === 200 });
}
