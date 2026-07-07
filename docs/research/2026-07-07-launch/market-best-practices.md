# 上線前市場調查：缺口與機會（2026-07-07）

**研究目的**：正式上線前，比對國內外同類免費共享平台的信任/活躍度機制，以及消費者 web 平台上線最佳實踐，找出 ShareGood 現有規格（見 `CLAUDE.md`「目前階段」）之外還沒發現的缺口與機會。

**研究方法**：WebSearch/WebFetch 查證國外平台（Freecycle、OLIO、Buy Nothing Project、Nextdoor）官方說明頁與第三方報導，台灣同類平台（GC贈物網／原 GIVE543）公開資訊，以及 2026 年行銷/SEO/AEO/冷啟動相關文章；另派 Explore subagent 逐項核對 ShareGood 程式碼庫（`prisma/schema.prisma`、`src/app/(shell)/...`、`src/components/report-button.tsx` 等）確認「已有／沒有」，避免憑印象誤判重工。所有結論皆附來源與查證日期（皆為 2026-07-07，除非另外標註）。

---

## 一、缺口清單

### A 級：上線前值得快速補（≤ 半天工作量，純文案/查詢/顯示層，不需新表或大改動線）

#### A1. 面交安全提示要出現在使用者「實際操作當下」，不是只在靜態頁
**現況查證**：程式碼比對確認，面交安全提示文案（「建議使用者選擇公開、安全的地點進行面交」「不要在私訊裡跟對方談錢」）目前只存在於 `src/app/terms/page.tsx:26` 與 `src/app/rules/page.tsx:18,23` 兩個獨立靜態頁面，`src/app/(shell)/items/[id]/handover-section.tsx`（交接流程本體）、`src/app/(shell)/conversations/[id]/conversation-thread.tsx`（私訊對話串）與 `src/components/onboarding-tour.tsx`（5 步新手導覽）三處使用者真正會操作交接的地方，全篇搜尋不到任何安全提示字樣——換句話說「有寫但沒人會在該看到的時候看到」。這正好對應 Facebook Marketplace／美國警方公開建議的核心原則：安全提示要出現在交易流程節點上，而不是藏在條款頁（見來源 1）。

**具體做法**：
- `handover-section.tsx`：在「開始交接」/顯示對話入口的區塊上方，加一行不可忽略的提示文字（例如：「面交小提醒：請選擇公開、有人潮的地點，可攜伴同行；交易全程建議留在站內訊息溝通，勿私下轉帳或加價」），純文案、無需新 state。
- `conversation-thread.tsx`：對話串第一次載入時（可用既有「無訊息時的空狀態」區塊）附加同一段安全提示，比照 `docs/research/.../empty-state.tsx` 既有元件模式即可帶過。
- `onboarding-tour.tsx`：既有 5 步導覽（逛好物／留言接手／分享／訊息交接／我的）在「訊息交接」那一步的說明文字，補上一句安全提醒（例如「記得約公開場所面交喔」），不新增步驟、只改既有字串。
- 驗收：三處文案更新後跑一次既有 Playwright 主迴路 E2E（`e2e/tests/main-loop.spec.ts`）確認流程未壞（新增文字不影響既有 DOM 選擇器的話應該零風險，若選擇器有衝突需微調）。

#### A2. 公開個人頁 `/u/[userId]` 補「加入時間」與「已完成分享/接手次數」
**現況查證**：`src/app/(shell)/u/[userId]/page.tsx:39-49` 目前只顯示暱稱＋累計貢獻值兩項；`Profile.createdAt` 資料庫已有欄位但頁面未讀取顯示，也沒有「完成次數」這種可以讓陌生使用者快速判斷「這個人是不是常態且可靠地在用」的信任訊號。這正是 Nextdoor 用「member since ＋ 在地推薦數」建立信任的做法（來源 2），也是 OLIO 用等級（karma level）暗示「這個人用得夠久、值得信任」的邏輯（來源 3）——ShareGood 目前的貢獻值雖然存在，但呈現形式對陌生訪客來說是個孤立數字，缺乏「這代表什麼」的脈絡。
**具體做法**：頁面已經在查 `ContributionEvent`／`Profile`，只需追加：
- 顯示 `Profile.createdAt` 轉換成「加入 ShareGood OO 天/OO 個月」。
- 追加一個查詢：從既有 `handover`/`thanks` 相關資料表 count 出「已完成分享 N 次、已接手 N 次」（不新增 schema，純聚合查詢，可仿照 `/admin` 儀表板既有的「查 db 算數字」寫法）。
- 純顯示層改動，無 API 契約變更、無遷移。

#### A3. 物品詳情頁在物主資訊旁同步顯示信任訊號，不用點進個人頁
**現況查證**：`src/app/(shell)/items/[id]/page.tsx:249-250` 物品詳情頁只顯示物主暱稱並連結到 `/u/[ownerId]`，沒有任何「已成功分享 N 次」之類的信號。陌生使用者要不要留言/認領，往往是在物品詳情頁那一刻就決定，此時看不到物主可信度是流失點。
**具體做法**：與 A2 共用同一個聚合查詢（同一個函式），在物主暱稱旁加一小段文字（例如「已分享 N 件好物」），無需另建 API。

**A 級整體驗收建議**：三項都不動 schema、不動 API 回應結構（A2/A3 頂多新增一個內部查詢函式），純屬「资料已存在、只是没显示」與「文案位置不對」的落差，適合在上線 PR 或上線前的最後一輪小修裡一次做完，且風險極低。

---

### B 級：上線後第一波（需要新 schema 欄位/新表、或牽涉產品決策，建議排進下一個 milestone）

- **B1：雙向星等互評系統**——目前只有單向「感謝留言」（`ThanksMessage`）與貢獻值，沒有 1–5 星等或「可靠度」評分。OLIO 的做法是雙方互評，且連續低評分會觸發帳號暫停（來源 3）；這對降低爽約風險、建立「這個人交接體驗好不好」的訊號有幫助，但涉及新表/遷移與呈現規則設計，非半天工作量。
- **B2：封鎖使用者（block user）**——程式碼確認完全沒有這個功能（`UserRestriction` 是管理員對違規者的限制，不是使用者互相封鎖）。多個平台（OLIO、Nextdoor）都有讓一般使用者主動封鎖騷擾對象的功能，目前 ShareGood 只能靠「檢舉」走管理員審核，反應速度較慢。
- **B3：收藏/我的最愛物品**——搜尋確認完全沒有 favorite/bookmark/wishlist 相關功能或 schema。在冷啟動期物品量少的情況下，讓使用者能「先收藏、之後再看」有助於提高回訪率，是常見的市集類產品標配。
- **B4：選配的手機號碼／簡訊驗證徽章**——OLIO 强制 SMS/WhatsApp 驗證所有使用者才能分享或用論壇（來源 3）。ShareGood 目前僅 Google OAuth，沒有電話驗證層。不建議強制（會增加註冊摩擦，且台灣使用者對此敏感），但可考慮做成「選配認證徽章」，優先套用在票券/優惠券等高價值物品的接手者身上。
- **B5：面交前主動提醒**——目前已有「爽約」事後標記機制（`no-show`），但沒有「約定時間前」的主動提醒。通用排程提醒工具的研究普遍指出，事前提醒本身就能顯著降低 no-show 率（來源 4）；ShareGood 通知基礎設施（M4/M8）已經很完整，補一則「面交提醒」通知模板技術上不難，但需要先確定資料模型有沒有記錄「約定面交時間」這個欄位（目前的交接流程是 lazy-create 的對話，沒有强制填時間），屬於要先決定產品行為的 B 級項目。
- **B6：地方政府/環保 NGO 合作曝光管道**——台灣已有「台北惜物網」（新北市與動產質借處合作的政府二手資源平台）與新北市「幸福小站」等前例，顯示地方政府對物資循環主題有既定興趣與预算（來源 5）；本土環保團體如 RE-THINK 重新思考也長期做相關倡議（來源 6）。這不是程式碼工作，但值得在冷啟動階段主動接洽做非付費曝光，故列在此處提醒別漏掉。

### C 級：長期方向

- **C1：綜合信任分數/徽章等級**——把貢獻值、（未來的）評分、完成率、檢舉紀錄合併成單一信任分數並對外顯示等級（比照 OLIO 的彩虹等級／rainbow hero，見來源 3），目前條件不成熟（缺評分與封鎖兩塊拼圖）。
- **C2：實名/地址驗證**——比照 Nextdoor 要求真實姓名與地址（來源 2）建立更強信任，但對台灣個資法遵循與註冊門檻衝擊大，只建議在未來出現高額爭議物品類別時才評估，且需法務審閱。
- **C3：社群論壇/討論區**——比照 OLIO Forum 經營社群氛圍與黏著度（來源 3），但需要額外的內容審核量能，現階段使用者量體與人力都不足以支撐，先不做。
- **C4：實體安心面交點**——比照北美部分地區推廣「警局停車場」等監視器覆蓋的公開安全交換區（來源 1），未來使用者量夠大時可考慮跟超商或里辦公處談固定「安心面交點」，現階段純屬構想。

---

## 二、已具備且不輸同業的功能（一句話帶過，避免重工）

- 先到先得認領＋抽籤兩種公平分配機制，皆有完整併發防搶佔（M1、M5）。
- 檢舉機制覆蓋物品／留言／私訊三處＋完整狀態機，且 `report-button.tsx` 在三個位置皆已上線可見（M2）。
- 強制下架、使用者限制/封號、申訴複審皆有 admin 後台與 RBAC 邊界（M2、M8 admin 面板）。
- no-show 標記＋貢獻值懲罰（-5）機制，已對應同業普遍缺乏的「爽約成本」設計（M1 感謝與貢獻值）。
- 關鍵字黑名單＋DB-based rate limit＋公開列表 API 的 IP 級節流，防洗版/防灌爆基礎已備（M2、缺口修正 wave）。
- SEO/AEO 基礎扎實：OG＋JSON-LD（Product/Offer、Article 兩種型別依內容類型區分）、動態 sitemap、robots.txt、`public/llms.txt`、`/rules` 頁面已有 FAQPage 結構化資料（M1 SEO、M9 DealInfo）。
- 全文關鍵字模糊搜尋（`/items?q=`，title/description contains、不分大小寫）＋城市/分類篩選＋到期排序（缺口修正 wave、M3）。
- 通知中心＋Telegram bot 綁定＋Web Push＋每日摘要＋通知合併防洗版，外部觸及管道比多數同規模平台齊全（M4、M6、M8）。
- 資料權利（自助匯出／刪除／去識別化）與法務保留（legal hold／調閱雙人審核）機制齊全，多數平台上線初期根本不會做到這個深度（M7）。
- 深色模式、PWA、5 步新手導覽、底部導覽 shell 統一體驗、`/admin/ops` 營運可觀測性儀表板（M8、M10、M11）。

---

## 三、冷啟動與宣傳建議（具體可執行，台灣在地脈絡）

1. **先衝供給、不衝用戶數**：空的共享平台等同「404」（來源 7）。建議上線初期由團隊與親友先手動上架 20–50 件真實物品，優先集中在使用者熟悉、有人脈可以快速促成第一批「先到先得」與「抽籤」成交的 1–2 個縣市，而不是一開始就想覆蓋全台 22 縣市——市集類產品的流動性是地區性的，密度比覆蓋率重要（來源 7、8）。
2. **借力既有社群而非硬廣**：台灣已存在大量 Facebook「二手贈送」「Buy Nothing 台灣分區」社團與 GC贈物網（原 GIVE543，累積 370 萬件成交，見來源 9）等既有生態；不必正面競爭，可在對應社團裡分享 ShareGood 連結，把「縣市級＋抽籤公平分配」當差異化賣點，同時附上已產出的物品詳情頁 OG 分享卡（技術面已具備，見上節）。
3. **善用已完成的 Threads 宣傳草稿**：`docs/research/2026-07-07-copywriting/` 已有 7 則草稿；Threads 在台灣的核心演算法偏好高互動、輕鬆語氣而非制式公告，可搭配投票功能與「開箱抽籤機制」等真實案例分階段發布（來源 10）。
4. **政府/環保 NGO 曝光管道**：可主動接洽地方環保局或 RE-THINK 重新思考等本土環保團體，以「歡迎試用回饋」角度尋求非付費曝光——台北惜物網、新北「幸福小站」等既有案例顯示地方政府對物資循環主題本就有既定興趣與預算（來源 5、6）。
5. **上線當週 SEO/AEO 執行清單**（技術基礎已具備，只差執行動作）：Google Search Console 提交 sitemap；用 Facebook Sharing Debugger／LinkedIn Post Inspector 各測一次真實物品頁的 OG 卡片渲染；首頁跑一次 PageSpeed/Core Web Vitals 基準；確認 `llms.txt` 內容與實際路由同步（來源 11、12）。
6. **首次面交安心感要在操作流程裡看得到**：與上節 A1 呼應——上線當週若能同步把安全提示嵌入交接流程，會直接降低第一批陌生使用者的疑慮，是最低成本、最高信任回報的動作。

---

## 來源清單（查證日期皆為 2026-07-07）

1. Facebook Marketplace 面交安全建議（well-lit public place、bring a friend、meet near police station）：[13 Facebook Marketplace Safety Tips](https://www.honestlymodern.com/stay-safe-using-facebook-marketplace/)、[How To Buy and Sell Safely on Facebook Marketplace](https://www.keepersecurity.com/blog/2023/07/21/how-to-buy-and-sell-safely-on-facebook-marketplace/)
2. Nextdoor 真實姓名/地址驗證與「member since」信任機制：[Nextdoor - Wikipedia](https://en.wikipedia.org/wiki/Nextdoor)、[Nextdoor Search: How to Find and Verify People on Nextdoor](https://socialcatfish.com/scamfish/nextdoor-search-how-to-find-and-verify-people-on-nextdoor/)
3. OLIO Karma Points、等級、SMS 驗證、評價機制與帳號暫停規則：[Karma Points | Olio Help Center](https://help.olioapp.com/en/articles/12240762-karma-points)、[How do ratings work on Olio?](https://help.olioapp.com/article/134-ratings-explained)、[Code verification - Olio](https://help.olioapp.com/article/183-code-verification)
4. 事前提醒降低 no-show 率（通用排程提醒產品的共通結論）：[Automated Reminders: Reduce No-Shows and Improve Attendance | Cal.com](https://cal.com/blog/automated-reminders-reduce-no-shows-and-improve-attendance)
5. 台北惜物網／新北市幸福小站（政府二手資源循環案例）：[二手資源 便宜有好貨-新北市政府財政局](https://www.finance.ntpc.gov.tw/home.jsp?id=36678cac09f774f3)
6. RE-THINK 重新思考（台灣本土環保 NGO）：[RE-THINK 重新思考首頁](https://rethinktw.org/)
7. 兩邊型市集冷啟動策略（先衝供給、地區密度優先於覆蓋率）：[Two-Sided Marketplace Cold Start: 2026 Playbook](https://forkoff.xyz/blog/founder-growth/two-sided-marketplace-cold-start-2026)、[Marketplace Cold Start: Which Side Do You Seed First?](https://internetmango.com/insights/marketplace-cold-start-strategy/)
8. Andrew Chen 冷啟動問題經典分析：[How to solve the cold-start problem for social products](https://andrewchen.com/how-to-solve-the-cold-start-problem-for-social-products/)
9. GC贈物網（原 GIVE543）平台介紹與累積成交數：[《GC贈物網》App - App Store](https://apps.apple.com/tw/app/gc%E8%B4%88%E7%89%A9%E7%B6%B2/id1433535336)、[【紅不讓的創業神蹟】GIVE543](https://buzzorange.com/techorange/2016/10/11/give543-redlineapp-miracle/)
10. Threads 在台灣的行銷策略與演算法偏好：[Threads「脆」倒底在紅什麼？](https://blog.shopline.tw/ads-article-threads-marketing/)、[Z世代最愛滑Threads！行銷人必懂Threads 4 大社群攻略](https://www.bnext.com.tw/article/81606/threads-marketing)
11. 新網站上線 SEO 執行清單（Search Console、PageSpeed、robots.txt 確認）：[SEO Checklist for a New Website in 2026](https://www.itsbuzzinteractive.com/blog/seo-checklist-for-website)
12. Open Graph 與 AEO/llms.txt 現況：[Open Graph Tags: Boost Social Sharing and SEO in 2026](https://www.imarkinfotech.com/open-graph-tags-boost-social-sharing-and-seo-in-2026/)、[What Is llms.txt and How to Implement It for AI Bots](https://www.elementera.com/blog/what-is-llms-txt-how-implement-for-ai-bots-2026-guide/)
13. Buy Nothing Project 十條規則（禁止轉賣/交換、信任基礎）：[The Buy Nothing Project - 10 Rules](https://buynothingproject.org/10-rules)

（ShareGood 現況引用之檔案路徑與行號，皆由本次研究派出的 Explore subagent 於 `/home/user/ShareGood` 程式碼庫中實際查證，非外部來源。）
