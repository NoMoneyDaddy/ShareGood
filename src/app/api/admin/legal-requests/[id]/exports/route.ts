import { ZipArchive } from "archiver";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { putObject } from "@/lib/storage";

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "long",
  timeStyle: "medium",
});

// POST /api/admin/legal-requests/[id]/exports — 依核准的調閱範圍產生匯出包（master-plan §7a
// 交付內容 6）。邏輯類似使用者自助資料匯出，但改為依 law_enforcement_request_targets 指定的
// 範圍查詢（而非「使用者自己的全部資料」），且只有 admin 能觸發。狀態必須是 approved 才能產生。
//
// ⚠️ 法律免責聲明：這裡的「必要最小揭露」範圍判斷（只依 target 直接關聯的資料，不做交叉
// 擴散查詢）僅為技術實作參考，正式營運前需台灣律師與平台法務審閱。
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("admin");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }

  const { id } = await params;
  const request = await db.lawEnforcementRequest.findUnique({
    where: { id },
    include: { targets: true },
  });
  if (!request) return jsonError("NOT_FOUND", "找不到這筆調閱請求");
  if (request.status !== "approved") {
    return jsonError("CONFLICT", "只有已核准的調閱請求才能產生匯出包");
  }

  const userIds = request.targets.filter((t) => t.targetType === "user").map((t) => t.targetId);
  const itemIds = request.targets.filter((t) => t.targetType === "item").map((t) => t.targetId);
  const conversationIds = request.targets
    .filter((t) => t.targetType === "conversation")
    .map((t) => t.targetId);
  const messageIds = request.targets
    .filter((t) => t.targetType === "message")
    .map((t) => t.targetId);

  const [users, items, conversations, messages] = await Promise.all([
    userIds.length
      ? db.user.findMany({ where: { id: { in: userIds } }, include: { profile: true } })
      : [],
    itemIds.length ? db.item.findMany({ where: { id: { in: itemIds } } }) : [],
    conversationIds.length
      ? db.conversation.findMany({
          where: { id: { in: conversationIds } },
          include: { messages: { orderBy: { createdAt: "asc" } }, members: true },
        })
      : [],
    messageIds.length ? db.message.findMany({ where: { id: { in: messageIds } } }) : [],
  ]);

  const readme = [
    "ShareGood 好物共享｜警方／檢調調閱匯出包",
    "",
    `案號：${request.caseReference}（${request.agencyName}）`,
    `產生時間：${TAIPEI_FORMATTER.format(new Date())}（台北時間）`,
    "本檔案僅供依法核准之調閱用途，禁止外流或作其他用途。",
  ].join("\n");

  const payload = JSON.stringify(
    {
      requestId: request.id,
      caseReference: request.caseReference,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        nickname: u.profile?.nickname ?? null,
        createdAt: u.createdAt,
      })),
      items,
      conversations,
      messages,
    },
    null,
    2,
  );

  const zipBuffer: Buffer = await new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.append(readme, { name: "README.txt" });
    archive.append(payload, { name: "data.json" });
    archive.finalize();
  });

  const objectKey = `law-enforcement-exports/${request.id}-${Date.now()}.zip`;
  await putObject(objectKey, zipBuffer, "application/zip");

  const exportRow = await db.$transaction(async (tx) => {
    const storageObject = await tx.storageObject.create({
      data: {
        objectKey,
        kind: "law_enforcement_export",
        status: "linked",
        mimeType: "application/zip",
        sizeBytes: zipBuffer.byteLength,
        uploaderId: actor.id,
        linkedAt: new Date(),
      },
    });
    const created = await tx.lawEnforcementExport.create({
      data: { requestId: id, storageObjectId: storageObject.id },
    });
    await tx.lawEnforcementRequest.update({ where: { id }, data: { status: "fulfilled" } });
    await tx.lawEnforcementRequestEvent.create({
      data: { requestId: id, action: "export_generated", actorId: actor.id },
    });
    return created;
  });

  await writeAudit({
    actorId: actor.id,
    action: "law_enforcement_request.export_generate",
    targetType: "law_enforcement_request",
    targetId: id,
    detail: { exportId: exportRow.id },
    sensitive: true,
  });

  return NextResponse.json({ id: exportRow.id }, { status: 201 });
}
