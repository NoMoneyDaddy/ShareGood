import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// GET /api/appeals/[id] — 申訴詳情：本人或 admin 可看（admin 複審前要能讀到附件與理由）。
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id } = await params;
  const appeal = await db.appeal.findUnique({
    where: { id },
    include: {
      itemRemoval: {
        select: {
          id: true,
          reason: true,
          note: true,
          createdAt: true,
          item: { select: { id: true, title: true, status: true } },
        },
      },
      userRestriction: {
        select: { id: true, type: true, reason: true, expiresAt: true, liftedAt: true },
      },
      evidence: {
        orderBy: { sortOrder: "asc" },
        select: { storageObjectId: true, storageObject: { select: { objectKey: true } } },
      },
    },
  });
  if (!appeal) return jsonError("NOT_FOUND", "找不到這筆申訴");

  const roles = new Set(user.roles.map((r) => r.role));
  const isAdmin = roles.has("admin");
  if (appeal.userId !== user.id && !isAdmin) {
    return jsonError("FORBIDDEN", "沒有權限查看這筆申訴");
  }

  return NextResponse.json({
    id: appeal.id,
    userId: appeal.userId,
    reason: appeal.reason,
    status: appeal.status,
    reviewNote: appeal.reviewNote,
    createdAt: appeal.createdAt,
    reviewedAt: appeal.reviewedAt,
    itemRemoval: appeal.itemRemoval,
    userRestriction: appeal.userRestriction,
    evidence: appeal.evidence.map((e) => ({
      storageObjectId: e.storageObjectId,
      objectKey: e.storageObject.objectKey,
    })),
  });
}

// PATCH /api/appeals/[id] — 僅限 admin 複審，決定 approved／rejected，需附 reviewNote。
// 核准時要「復原」對應的下架/限制：
//   - itemRemovalId：物品轉回 published（並寫 item_status_logs），讓被下架的物品重新上架。
//   - userRestrictionId：把 UserRestriction 標記為 liftedAt/liftedBy（沿用既有「提前解除」
//     欄位語意），而不是刪除這筆紀錄——刪除會讓「這個使用者曾被限制過」的稽核軌跡消失，
//     跟 liftedAt 已經是這張表本來就有、給「提前解除」用的既有欄位相衝突；用 liftedAt
//     可以讓 requireUser/資格檢查等既有邏輯（若日後有查 UserRestriction 判斷是否仍受限）
//     自然把「已解除」的限制視為不生效，同時完整保留歷史紀錄可供稽核。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin: Awaited<ReturnType<typeof requireRole>>;
  try {
    admin = await requireRole("admin");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;
  const reviewNote = typeof body?.reviewNote === "string" ? body.reviewNote.trim() : "";

  if (status !== "approved" && status !== "rejected") {
    return jsonError("UNPROCESSABLE", "status 必須是 approved 或 rejected");
  }
  if (reviewNote.length < 1 || reviewNote.length > 1000) {
    return jsonError("UNPROCESSABLE", "複審備註需為 1–1000 個字");
  }

  const appeal = await db.appeal.findUnique({ where: { id } });
  if (!appeal) return jsonError("NOT_FOUND", "找不到這筆申訴");
  if (appeal.status !== "pending") {
    return jsonError("CONFLICT", "此申訴已審核過");
  }

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    // 用 updateMany 帶 status: "pending" 條件做原子性「認領」，避免兩個 admin 同時
    // 複審同一筆申訴時重複復原下架/限制（比照 direct-shares accept 的既有模式）。
    const claimed = await tx.appeal.updateMany({
      where: { id, status: "pending" },
      data: { status, reviewedBy: admin.id, reviewNote, reviewedAt: now },
    });
    if (claimed.count === 0) {
      return { ok: false as const };
    }

    if (status === "approved") {
      if (appeal.itemRemovalId) {
        const removal = await tx.itemRemoval.findUnique({ where: { id: appeal.itemRemovalId } });
        if (removal) {
          // 只有物品目前仍是 removed_by_moderator 才轉回 published；如果狀態已經被
          // 其他方式改變（理論上不該發生，但求穩），就略過物品狀態變更，申訴審核結果
          // 仍然照使用者的決定記錄下來。
          // publishedAt 重蓋成現在：master-plan §6a M6 訂閱通知比對 job 靠 (publishedAt, id)
          // cursor 掃描新上架物品，物品從 removed_by_moderator 復原成 published 若不更新
          // publishedAt，舊時間點會小於 cursor 已經前進的位置，導致這次「復原上架」永遠不會被
          // 訂閱比對 job 掃到（同時也讓復原後的物品在前台列表重新置頂，符合直覺）。
          const itemUpdated = await tx.item.updateMany({
            where: { id: removal.itemId, status: "removed_by_moderator" },
            data: { status: "published", publishedAt: now },
          });
          if (itemUpdated.count === 1) {
            await tx.itemStatusLog.create({
              data: {
                itemId: removal.itemId,
                fromStatus: "removed_by_moderator",
                toStatus: "published",
                actorId: admin.id,
                reason: "申訴核准，復原上架",
              },
            });
          }
        }
      }
      if (appeal.userRestrictionId) {
        await tx.userRestriction.updateMany({
          where: { id: appeal.userRestrictionId, liftedAt: null },
          data: { liftedAt: now, liftedBy: admin.id },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "appeal.review",
        targetType: "appeal",
        targetId: id,
        detail: {
          status,
          itemRemovalId: appeal.itemRemovalId,
          userRestrictionId: appeal.userRestrictionId,
          reviewNote,
        },
      },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    return jsonError("CONFLICT", "此申訴已審核過");
  }

  return NextResponse.json({ id, status, reviewNote, reviewedAt: now });
}
