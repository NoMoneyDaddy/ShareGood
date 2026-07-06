import { ZipArchive } from "archiver";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl, publicUrl } from "@/lib/storage";

// 資料自助匯出（master-plan §7a 交付內容 2）：把「這個使用者是誰」相關的資料組成一組
// 清楚易讀的 JSON + README.txt，格式選擇不特別遵循國際標準（見規格「不做」段落）。
// 圖片本身不進 zip，只在 items.json 附上簽名下載連結，連結有效期與整包匯出的
// expires_at 一致（呼叫端傳入 signedUrlExpiresInSeconds）。

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "long",
  timeStyle: "medium",
});

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export type ExportPackageFiles = Record<string, string>;

/**
 * 組出匯出包所有檔案內容（檔名 -> 檔案文字內容），呼叫端負責壓縮成 zip 並上傳。
 * 所有查詢都限定 userId 相關資料，訊息部分只顯示對話另一方「目前」的暱稱（schema 沒有
 * 訊息當下的暱稱快照欄位，這是既有 schema 已凍結下的技術限制，並非刻意設計）。
 */
export async function buildExportPackageFiles(
  userId: string,
  opts: { signedUrlExpiresInSeconds: number; generatedAt: Date; expiresAt: Date },
): Promise<ExportPackageFiles> {
  const [user, profile, items, claims, directSharesReceived, ownedItemIds] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    db.profile.findUnique({ where: { userId } }),
    db.item.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      include: {
        images: {
          orderBy: { sortOrder: "asc" },
          include: { thumbObject: true, mediumObject: true },
        },
        category: true,
        city: true,
        couponDetail: true,
      },
    }),
    db.claimComment.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.directShare.findMany({
      where: { receiverId: userId },
      orderBy: { createdAt: "asc" },
      include: { item: { select: { id: true, title: true, ownerId: true } } },
    }),
    db.item.findMany({ where: { ownerId: userId }, select: { id: true } }),
  ]);

  const ownedItemIdList = ownedItemIds.map((i) => i.id);

  const [directSharesOfMine, handoversAsReceiver, handoversOfMyItems, thanksSent, thanksReceived] =
    await Promise.all([
      db.directShare.findMany({
        where: { itemId: { in: ownedItemIdList } },
        orderBy: { createdAt: "asc" },
        include: {
          item: { select: { id: true, title: true } },
          receiver: { select: { id: true } },
        },
      }),
      db.handoverRecord.findMany({
        where: { receiverId: userId },
        orderBy: { createdAt: "asc" },
        include: { item: { select: { id: true, title: true, ownerId: true } } },
      }),
      db.handoverRecord.findMany({
        where: { itemId: { in: ownedItemIdList } },
        orderBy: { createdAt: "asc" },
        include: { item: { select: { id: true, title: true } } },
      }),
      db.thanksMessage.findMany({
        where: { fromUserId: userId },
        orderBy: { createdAt: "asc" },
        include: { item: { select: { id: true, title: true } } },
      }),
      db.thanksMessage.findMany({
        where: { toUserId: userId },
        orderBy: { createdAt: "asc" },
        include: { item: { select: { id: true, title: true } } },
      }),
    ]);

  const conversations = await db.conversation.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "asc" },
    include: {
      item: { select: { id: true, title: true } },
      members: { include: { user: { include: { profile: true } } } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { include: { profile: true } } },
      },
    },
  });

  const [contributionEvents, contributionSum, notifications] = await Promise.all([
    db.contributionEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.contributionEvent.aggregate({ where: { userId }, _sum: { points: true } }),
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  async function imageUrls(objectKey: string, status: string) {
    // pending/linked 都代表 MinIO 上確實還有這個物件；deleted 代表已被 retention job 清掉，
    // 此時不產生簽名連結（簽了也拿不到檔案），改標記檔案已不存在。
    if (status === "deleted") return null;
    return getPresignedDownloadUrl(objectKey, opts.signedUrlExpiresInSeconds).catch(
      () => publicUrl(objectKey), // 極端情況簽名失敗時退回未簽名網址，至少不整包失敗
    );
  }

  const itemsJson = await Promise.all(
    items.map(async (item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status,
      category: item.category.name,
      city: item.city.name,
      createdAt: iso(item.createdAt),
      publishedAt: iso(item.publishedAt),
      expiresAt: iso(item.expiresAt),
      images: await Promise.all(
        item.images.map(async (img) => ({
          sortOrder: img.sortOrder,
          thumbUrl: await imageUrls(img.thumbObject.objectKey, img.thumbObject.status),
          mediumUrl: await imageUrls(img.mediumObject.objectKey, img.mediumObject.status),
        })),
      ),
      coupon: item.couponDetail
        ? {
            faceValue: item.couponDetail.faceValue,
            merchantName: item.couponDetail.merchantName,
            notes: item.couponDetail.notes,
            // 券碼明文刻意不匯出：即使是本人，明文只透過既有「交接確定後接手者揭露」
            // 這唯一入口取得（見 master-plan §8），資料匯出不另開一個繞過管道。
          }
        : null,
    })),
  );

  const claimsJson = claims.map((c) => ({
    id: c.id,
    itemId: c.itemId,
    message: c.message,
    status: c.status,
    createdAt: iso(c.createdAt),
  }));

  const directSharesJson = {
    received: directSharesReceived.map((d) => ({
      id: d.id,
      itemId: d.itemId,
      itemTitle: d.item.title,
      status: d.status,
      createdAt: iso(d.createdAt),
      respondedAt: iso(d.respondedAt),
      expiresAt: iso(d.expiresAt),
    })),
    sentFromMyItems: directSharesOfMine.map((d) => ({
      id: d.id,
      itemId: d.itemId,
      itemTitle: d.item.title,
      // 對方是誰只揭露內部 id，不揭露對方 email/暱稱以外的任何資料（見規格「不含其他
      // 使用者的私密資料」）。
      receiverUserId: d.receiver.id,
      status: d.status,
      createdAt: iso(d.createdAt),
    })),
  };

  const handoversJson = {
    asReceiver: handoversAsReceiver.map((h) => ({
      id: h.id,
      itemId: h.itemId,
      itemTitle: h.item.title,
      status: h.status,
      ownerConfirmedAt: iso(h.ownerConfirmedAt),
      receiverConfirmedAt: iso(h.receiverConfirmedAt),
      completedAt: iso(h.completedAt),
      createdAt: iso(h.createdAt),
    })),
    onMyItemsAsOwner: handoversOfMyItems.map((h) => ({
      id: h.id,
      itemId: h.itemId,
      itemTitle: h.item.title,
      status: h.status,
      ownerConfirmedAt: iso(h.ownerConfirmedAt),
      receiverConfirmedAt: iso(h.receiverConfirmedAt),
      completedAt: iso(h.completedAt),
      createdAt: iso(h.createdAt),
    })),
  };

  const messagesJson = conversations.map((c) => ({
    conversationId: c.id,
    itemId: c.itemId,
    itemTitle: c.item.title,
    // 對話另一方只顯示「目前」暱稱（不是當時快照，schema 未存這個歷史欄位）。
    otherMembers: c.members
      .filter((m) => m.userId !== userId)
      .map((m) => ({ nickname: m.user.profile?.nickname ?? "（已刪除的使用者）" })),
    messages: c.messages.map((m) => ({
      senderIsMe: m.senderId === userId,
      senderNickname: m.sender.profile?.nickname ?? "（已刪除的使用者）",
      body: m.body,
      createdAt: iso(m.createdAt),
    })),
  }));

  const thanksJson = {
    sent: thanksSent.map((t) => ({
      id: t.id,
      itemId: t.itemId,
      itemTitle: t.item.title,
      message: t.message,
      createdAt: iso(t.createdAt),
    })),
    received: thanksReceived.map((t) => ({
      id: t.id,
      itemId: t.itemId,
      itemTitle: t.item.title,
      message: t.message,
      createdAt: iso(t.createdAt),
    })),
  };

  const contributionJson = {
    totalPoints: contributionSum._sum.points ?? 0,
    events: contributionEvents.map((e) => ({
      type: e.type,
      points: e.points,
      itemId: e.itemId,
      createdAt: iso(e.createdAt),
    })),
  };

  const notificationsJson = notifications.map((n) => ({
    type: n.type,
    payload: n.payload,
    readAt: iso(n.readAt),
    createdAt: iso(n.createdAt),
  }));

  const profileJson = {
    userId: user.id,
    name: user.name,
    email: user.email,
    createdAt: iso(user.createdAt),
    nickname: profile?.nickname ?? null,
    cityId: profile?.cityId ?? null,
    bio: profile?.bio ?? null,
  };

  const readme = [
    "ShareGood 好物共享｜個人資料匯出說明",
    "",
    `匯出產生時間：${TAIPEI_FORMATTER.format(opts.generatedAt)}（台北時間）`,
    `本次匯出下載連結有效期至：${TAIPEI_FORMATTER.format(opts.expiresAt)}（台北時間），逾期將自動清除。`,
    "",
    "本壓縮檔包含以下檔案（皆為 UTF-8 編碼 JSON，可用文字編輯器或任何支援 JSON 的工具開啟）：",
    "- profile.json：你的帳號與個人資料（暱稱、所在縣市、自我介紹）。",
    "- items.json：你名下所有物品（含已下架/已完成），每張圖片附上有時效的下載連結。",
    "- claims.json：你發過的留言／索取紀錄。",
    "- direct_shares.json：你分享或收到的「指定分享」紀錄。",
    "- handovers.json：你參與過的交接紀錄（無論是物主或接手者身分）。",
    "- messages.json：你參與的私訊對話與訊息內容；對話另一方僅顯示暱稱，不含其他個人資料。",
    "- thanks.json：你發出或收到的感謝留言。",
    "- contribution.json：你的貢獻值紀錄與目前累積總分。",
    "- notifications.json：你的站內通知歷史。",
    "",
    "本頁與本檔案由系統自動產生，若對資料內容有疑問，請透過站內客服聯繫。",
  ].join("\n");

  return {
    "README.txt": readme,
    "profile.json": JSON.stringify(profileJson, null, 2),
    "items.json": JSON.stringify(itemsJson, null, 2),
    "claims.json": JSON.stringify(claimsJson, null, 2),
    "direct_shares.json": JSON.stringify(directSharesJson, null, 2),
    "handovers.json": JSON.stringify(handoversJson, null, 2),
    "messages.json": JSON.stringify(messagesJson, null, 2),
    "thanks.json": JSON.stringify(thanksJson, null, 2),
    "contribution.json": JSON.stringify(contributionJson, null, 2),
    "notifications.json": JSON.stringify(notificationsJson, null, 2),
  };
}

/** 把 buildExportPackageFiles 的結果壓成一個 zip buffer。 */
export async function zipExportPackage(files: ExportPackageFiles): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name });
    }
    archive.finalize();
  });
}
