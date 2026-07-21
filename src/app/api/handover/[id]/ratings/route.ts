import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkKeywordBlocklist } from "@/lib/keyword-blocklist";
import { getEventTypeDefaults } from "@/lib/notification-preferences";
import { createOrMergeNotification } from "@/lib/notifications";
import { checkFullBlock } from "@/lib/restrictions";

// M12 交付內容 1（雙向互評，docs/plan/m12-product-growth.md）：交接完成後物主與接手者
// 各自可對另一方留一次 1–5 星評分＋可選評語。
//
// POST /api/handover/[id]/ratings — 給分。
// 防重複：直接 create，撞 @@unique([handoverRecordId, raterId]) 的 P2002 捕捉回 409
// （比照 thanks route 既定寫法，不先 findFirst 再 create，避免併發競態）。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: handoverId } = await params;
  const handover = await db.handoverRecord.findUnique({
    where: { id: handoverId },
    include: { item: { select: { id: true, ownerId: true, title: true } } },
  });
  if (!handover) return jsonError("NOT_FOUND", "找不到這筆交接紀錄");

  const isOwner = user.id === handover.item.ownerId;
  const isReceiver = user.id === handover.receiverId;
  if (!isOwner && !isReceiver) {
    return jsonError("FORBIDDEN", "只有物主或接手者可以評分這筆交接");
  }

  if (handover.status !== "completed") {
    return jsonError("CONFLICT", "這筆交接還沒完成，無法評分");
  }

  const rateeId = isOwner ? handover.receiverId : handover.item.ownerId;

  const body = await req.json().catch(() => null);
  const stars = typeof body?.stars === "number" ? body.stars : Number.NaN;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return jsonError("UNPROCESSABLE", "星等需為 1–5 的整數");
  }

  let comment: string | null = null;
  if (body?.comment !== undefined && body?.comment !== null) {
    const trimmed = typeof body.comment === "string" ? body.comment.trim() : "";
    if (trimmed.length < 1 || trimmed.length > 300) {
      return jsonError("UNPROCESSABLE", "評語需為 1–300 個字");
    }
    const hit = await checkKeywordBlocklist(trimmed);
    if (hit) {
      return jsonError("UNPROCESSABLE", "評語包含不允許的字詞");
    }
    comment = trimmed;
  }

  // 通知偏好：比照 M6 subscription-notify.ts 的較嚴謹模式（M12 決策 2），先查
  // inAppEnabled 才建立站內通知，而不是像 M1–M3 舊事件那樣直接 create。
  const pref = await db.notificationPreference.findUnique({
    where: { userId_eventType: { userId: rateeId, eventType: "handover_rating_received" } },
    select: { inAppEnabled: true },
  });
  const inAppEnabled =
    pref?.inAppEnabled ?? getEventTypeDefaults("handover_rating_received").defaultInAppEnabled;

  let created: { id: string; stars: number; comment: string | null; createdAt: Date };
  try {
    created = await db.$transaction(async (tx) => {
      const rating = await tx.handoverRating.create({
        data: { handoverRecordId: handoverId, raterId: user.id, rateeId, stars, comment },
        select: { id: true, stars: true, comment: true, createdAt: true },
      });
      if (inAppEnabled) {
        // NotificationType 沒有專屬的「收到評分」類型；重用 completion_confirmed，跟既有
        // thanks/item-expiration/lottery 等事件同一套既定做法，payload.kind 判別。
        await createOrMergeNotification(tx, {
          userId: rateeId,
          type: "completion_confirmed",
          payload: {
            kind: "handover_rating_received",
            itemId: handover.item.id,
            itemTitle: handover.item.title,
          },
        });
      }
      return rating;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("CONFLICT", "這筆交接你已經評過分了");
    }
    throw e;
  }

  return NextResponse.json(created, { status: 201 });
}

// GET /api/handover/[id]/ratings — 查詢這筆交接雙方各自的評分狀態。
// 雙盲揭露（M12 決策）：`other` 只有在「我已經提交」且「對方也已經提交」時才回傳內容，
// 否則一律 null——即使自己已經評分、對方還沒評分時也看不到（因為對方根本還沒有資料）；
// 即使對方已經評分、自己還沒評分時也看不到（故意不讓「先看到對方評分」誘發報復性評分）。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: handoverId } = await params;
  const handover = await db.handoverRecord.findUnique({
    where: { id: handoverId },
    include: { item: { select: { ownerId: true } } },
  });
  if (!handover) return jsonError("NOT_FOUND", "找不到這筆交接紀錄");

  const isOwner = user.id === handover.item.ownerId;
  const isReceiver = user.id === handover.receiverId;
  if (!isOwner && !isReceiver) {
    return jsonError("FORBIDDEN", "只有物主或接手者可以查看這筆交接的評分");
  }

  const ratings = await db.handoverRating.findMany({
    where: { handoverRecordId: handoverId },
    select: { raterId: true, stars: true, comment: true, createdAt: true },
  });
  const mineRow = ratings.find((r) => r.raterId === user.id) ?? null;
  const otherRow = ratings.find((r) => r.raterId !== user.id) ?? null;

  return NextResponse.json({
    mine: mineRow
      ? { stars: mineRow.stars, comment: mineRow.comment, createdAt: mineRow.createdAt }
      : null,
    // 雙盲：other 只在 mine 也存在時才揭露。
    other:
      mineRow && otherRow
        ? { stars: otherRow.stars, comment: otherRow.comment, createdAt: otherRow.createdAt }
        : null,
  });
}
