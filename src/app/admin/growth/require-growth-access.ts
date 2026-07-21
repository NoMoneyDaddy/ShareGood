import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";

/**
 * `/admin/growth` 的權限檢查（master-plan §10a／docs/plan/m12-product-growth.md
 * 交付內容 6）：moderator/admin 才能看，其餘一律 404（比照 `/admin/ops` 的
 * `require-ops-access.ts` 既定寫法，不透露頁面存在）。
 */
export async function requireGrowthPageAccess() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();
  return user;
}
