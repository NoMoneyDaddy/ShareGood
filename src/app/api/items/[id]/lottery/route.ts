import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// POST /api/items/[id]/lottery — 物主為自己名下 draft/published 物品開一場抽籤
// （master-plan §5a 交付內容 3）。entryDeadline 建立後不可修改，設錯只能整個取消
// （見規格「已知取捨」）；`lotteries.itemId` 是 @unique，DB 層本身就擋掉「同一物品建立第二次」，
// 不論是「已有進行中抽籤」還是「先前已經 cancelled/failed_no_entries 用掉終身資格」皆一體適用。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }
  if (!user.profile) {
    return jsonError("FORBIDDEN", "請先完成基本資料設定");
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: itemId } = await params;
  const item = await db.item.findUnique({ where: { id: itemId } });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  if (item.ownerId !== user.id) return jsonError("FORBIDDEN", "只有物主可以為這個物品開抽籤");
  if (item.status !== "draft" && item.status !== "published") {
    return jsonError("CONFLICT", "這個物品目前無法開抽籤");
  }

  const body = await req.json().catch(() => null);
  const entryDeadline = parseEntryDeadline(body?.entryDeadline);
  if (!entryDeadline) {
    return jsonError("UNPROCESSABLE", "報名截止時間格式不正確或需晚於現在");
  }

  try {
    const lottery = await db.lottery.create({
      data: {
        itemId,
        creatorId: user.id,
        entryDeadline,
        status: "open",
      },
      select: { id: true, entryDeadline: true, status: true },
    });
    return NextResponse.json(lottery, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("CONFLICT", "這個物品已經開過抽籤，一物品終身只能抽籤一次");
    }
    throw e;
  }
}

// GET /api/items/[id]/lottery — 公開查詢目前抽籤狀態；不揭露其他報名者身份，
// 只回自己是否已報名、以及自己的排名結果（若已開獎）（master-plan §5a 交付內容 3）。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: itemId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const lottery = await db.lottery.findUnique({
    where: { itemId },
    select: { id: true, status: true, entryDeadline: true, creatorId: true },
  });
  if (!lottery) {
    return NextResponse.json({ exists: false });
  }

  const [entryCount, myEntry, myResult] = await Promise.all([
    db.lotteryEntry.count({ where: { lotteryId: lottery.id, status: "entered" } }),
    userId
      ? db.lotteryEntry.findUnique({
          where: { lotteryId_userId: { lotteryId: lottery.id, userId } },
          select: { status: true },
        })
      : null,
    userId
      ? db.lotteryResult.findFirst({
          where: { lotteryId: lottery.id, userId },
          select: { rank: true, status: true, confirmDeadline: true, respondedAt: true },
        })
      : null,
  ]);

  return NextResponse.json({
    exists: true,
    id: lottery.id,
    status: lottery.status,
    entryDeadline: lottery.entryDeadline,
    entryCount,
    isOwner: userId === lottery.creatorId,
    myEntryStatus: myEntry?.status ?? null,
    myResult: myResult
      ? {
          rank: myResult.rank,
          status: myResult.status,
          confirmDeadline: myResult.confirmDeadline,
          respondedAt: myResult.respondedAt,
        }
      : null,
  });
}

function parseEntryDeadline(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() <= Date.now()) return null;
  return parsed;
}
