import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  providers: [Google],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // ADMIN_EMAIL 首次（含之後每次）登入自動持有 admin 角色。
    // 不在 seed 預建 User：預建的列沒有 OAuth 連結，會觸發 OAuthAccountNotLinked 擋登入。
    async signIn({ user }) {
      if (!user.id || !user.email) return;
      if (user.email !== process.env.ADMIN_EMAIL) return;
      await db.userRole.upsert({
        where: { userId_role: { userId: user.id, role: "admin" } },
        update: {},
        create: { userId: user.id, role: "admin" },
      });
    },
  },
});
