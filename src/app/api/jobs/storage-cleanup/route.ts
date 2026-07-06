import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { filterUnderLegalHold } from "@/lib/legal-hold";
import { deleteObject } from "@/lib/storage";

// 每日清理孤兒檔（master-plan §5）：上傳後 48 小時仍未被任何實體引用的 pending 物件。
// 由外部 cron 以 Authorization: Bearer ${CRON_SECRET} 觸發。
//
// M7（master-plan §7a 交付內容 5）補充：這批物件理論上都還沒被任何實體引用，本來就不太
// 可能是 legal hold 的保全目標，但保守起見仍補上檢查——成本低，避免未來 legal hold 的
// target_type 擴充涵蓋 storage_object 時出現遺漏。
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
  let skippedLegalHold = 0;
  const heldIds = await filterUnderLegalHold(
    "storage_object",
    orphans.map((obj) => obj.id),
  );
  for (const obj of orphans) {
    if (heldIds.has(obj.id)) {
      skippedLegalHold++;
      continue;
    }
    await deleteObject(obj.objectKey).catch(() => {
      /* MinIO 上已不存在也視為清理成功 */
    });
    await db.storageObject.update({
      where: { id: obj.id },
      data: { status: "deleted", deletedAt: new Date() },
    });
    deleted++;
  }

  return NextResponse.json({ deleted, skippedLegalHold, remaining: orphans.length === 200 });
}
