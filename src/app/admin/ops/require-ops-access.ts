import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";

/**
 * `/admin/ops` 四個分頁共用的權限檢查（master-plan §8a 交付內容 7）：moderator/admin
 * 才能看，其餘一律 404（不透露這個頁面存在，比照既有 `/admin/support-tickets` 慣例——
 * API 端另外走 403，見 `src/lib/ops-authz.ts`；頁面與 API 刻意用不同狀態碼是延續既有
 * 專案慣例，不是本次新增的差異）。
 */
export async function requireOpsPageAccess() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();
  return user;
}
