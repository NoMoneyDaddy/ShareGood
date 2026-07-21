import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// GET /api/me/blocks — 我封鎖的名單分頁列表（docs/plan/m12-product-growth.md 交付內容 3），
// 供 /me/blocked-users 管理頁使用。這支 API 對封鎖發起人完全透明，無感知封鎖只影響被封鎖方。
export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const blocks = await db.userBlock.findMany({
    where: { blockerId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      blockedId: true,
      createdAt: true,
      blocked: { select: { profile: { select: { nickname: true } } } },
    },
  });

  const hasMore = blocks.length > take;
  const page = hasMore ? blocks.slice(0, take) : blocks;

  return NextResponse.json({
    blocks: page.map((b) => ({
      id: b.id,
      blockedId: b.blockedId,
      nickname: b.blocked.profile?.nickname ?? "好物共享使用者",
      createdAt: b.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
