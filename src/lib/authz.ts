import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

export class AuthzError extends Error {
  constructor(public code: "UNAUTHORIZED" | "FORBIDDEN") {
    super(code);
  }
}

/** 取得目前登入者（含角色與 profile）；未登入丟 UNAUTHORIZED。 */
export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AuthzError("UNAUTHORIZED");

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { roles: true, profile: true },
  });
  if (!user) throw new AuthzError("UNAUTHORIZED");
  return user;
}

/** 要求特定角色；不足丟 FORBIDDEN。admin 隱含 moderator 權限。 */
export async function requireRole(role: Role) {
  const user = await requireUser();
  const roles = new Set(user.roles.map((r) => r.role));
  const ok =
    roles.has(role) || (role === "moderator" && roles.has("admin"));
  if (!ok) throw new AuthzError("FORBIDDEN");
  return user;
}
