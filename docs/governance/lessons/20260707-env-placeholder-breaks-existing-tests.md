# worktree 複製 `.env` 時用同一套「非空 placeholder」補所有缺變數，反而讓既有整合測試冒出新的失敗

- 日期：2026-07-07
- 情境：M9 schema 地基派工的流程要求「複製主 repo `.env`，缺變數比照 `.env.example` 補佔位」。
  主 repo `.env` 只有 `DATABASE_URL`／`ADMIN_EMAIL`／`AUTH_SECRET`／`AUTH_URL`／
  `AUTH_TRUST_HOST`／`CRON_SECRET` 六個變數，其餘（`S3_*`、`COUPON_SECRET_KEY`、
  `TELEGRAM_*`、`WEB_PUSH_VAPID_*`）都缺。第一次補齊時圖省事，全部缺的變數一律填
  `"placeholder"` 這種非空假字串。
- 症狀：跑 `npx vitest run --config vitest.config.ts` 後除了已知的 5 個 M7 MinIO 失敗
  （baseline），多出 `ops-notification-retry.test.ts` 一個新失敗：預期
  `lastError` 是 `"TELEGRAM_BOT_TOKEN 未設定"`，實際卻是 Telegram API 真的回應的
  `"Not Found"`。第一次修法把 `TELEGRAM_BOT_TOKEN` 改空字串後，`telegram.test.ts`
  （7 個測試）與 `web-push.test.ts`（5 個測試）反而從全過變成全部失敗——因為
  `TELEGRAM_BOT_USERNAME`／`TELEGRAM_WEBHOOK_SECRET`／`WEB_PUSH_VAPID_PUBLIC_KEY`／
  `WEB_PUSH_VAPID_PRIVATE_KEY` 這幾個我也順手清成空字串了。
- 根本原因：不同的環境變數在程式碼裡的「空值語意」完全不同，不能一套 placeholder 邏輯套用
  全部：
  - `TELEGRAM_BOT_TOKEN`：程式碼用 `if (!token)` 判斷「未設定」並回特定錯誤訊息，**必須留空**，
    填任何非空字串都會讓程式改走「真的呼叫 Telegram API」那條路徑，本機無此憑證會打出
    非預期的錯誤（`"Not Found"` 而非設計中的錯誤訊息）。
  - `TELEGRAM_BOT_USERNAME`／`TELEGRAM_WEBHOOK_SECRET`：只要求字串存在（用來組深連結／比對
    webhook header），**必須非空**，可以是任意假字串。
  - `WEB_PUSH_VAPID_PUBLIC_KEY`／`WEB_PUSH_VAPID_PRIVATE_KEY`：`web-push` 套件在載入時會
    驗證 VAPID 金鑰格式（base64url 編碼、特定長度），填 `"placeholder"` 這種不合格式的字串
    會讓套件初始化失敗，**必須是真的用 `npx web-push generate-vapid-keys` 產生的金鑰對**
    （值本身可以是任意假帳號產生的，重點是格式合法）。
- 修法：查其他平行開發中 worktree（如 `feat/m6-subscriptions-webpush`、
  `feature/gap-telegram-pipeline`）已經跑通測試的 `.env`，直接對照它們每個變數是空字串
  還是有值、格式長什麼樣，不要自己瞎猜。改完 `.env` 依規範重啟 `next dev`
  （`rm -rf .next`、精確 `fuser -k <port>/tcp`、看到 `✓ Ready` 字樣才算新行程），
  再跑一次整合測試確認沒有新失敗、只剩已知的 M7 MinIO baseline。
- 引申規則：**worktree 複製 `.env` 缺變數要補值時，不要用單一 placeholder 字串打遍全部**。
  先看有沒有其他已跑通的 worktree 可以直接抄對應變數的值/格式；沒有的話，針對每個變數去
  程式碼裡搜尋 `process.env.<NAME>` 確認「空字串」與「填了值」兩種狀態各自觸發什麼行為，
  再決定要留空還是要填、填什麼格式。改完 `.env` 後即使沒有新增功能程式碼，也要重跑一次全套
  整合測試比對已知 baseline（失敗數與失敗案例是否一致），不能只看「有沒有噴錯」。

## 追加（2026-07-07，M9 券類強化派工）：另外兩個變數的具體症狀

同一根本原因（worktree `.env` 只複製六個核心變數）在 M9 券類強化派工又踩到兩個新變數，
症狀跟原因記錄如下，省得下一個 session 重新從頭排查：

- `COUPON_SECRET_KEY` 完全缺漏：任何 `POST /api/items` 建立優惠券物品都會 500（
  `src/lib/coupon-crypto.ts` 的 `loadKey()` 直接 throw
  `"COUPON_SECRET_KEY 未設定，無法加密／解密券碼"`）。修法：用
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  產生一組 64 個 hex 字元（32 bytes）的假金鑰即可，不需要對照其他 worktree（每個 worktree
  各自產生獨立金鑰完全沒問題，這個值不需要跨環境一致）。
- `S3_PUBLIC_URL`（連同 `S3_ENDPOINT`／`S3_ACCESS_KEY`／`S3_SECRET_KEY`／`S3_BUCKET`）缺漏：
  **不影響需要真的呼叫 MinIO 的功能以外的頁面**，但只要頁面用 `next/image` 渲染任何物品圖片
  （首頁、`/items` 列表、物品詳情頁），`src/lib/storage.ts` 的 `publicUrl()` 會組出
  `"undefined/images/<uuid>/thumb.webp"` 這種字串，`next/image` 解析失敗直接讓整支
  server component 500（不是圖片本身破圖，是整頁掛掉）。症狀在 dev log 裡是
  `TypeError: Invalid URL` + `Failed to parse src "undefined/images/..." on next/image`。
  這個 500 **只在頁面剛好查到有圖片的物品時才會觸發**，所以一開始測 `curl /` 兩次可能都是
  200（如果那兩次查到的物品剛好還沒有圖片，或剛好還沒有任何測試建立物品），要等整合測試
  實際建立帶圖片的物品、又剛好命中首頁/列表查詢範圍時才會冒出來——不要以為「開工前手動點兩次
  200」就代表這條路徑沒問題，跑完整合測試套件後還是要重看一次失敗清單。修法：不需要真的
  MinIO 在跑，只要五個 `S3_*` 變數都填非空字串（值本身可以是假的，例如
  `S3_PUBLIC_URL="http://localhost:9200/sharegood"`，照抄 `agent-m6-subscriptions`／
  `agent-gap-browse` 等已跑通 worktree 的格式即可），`publicUrl()` 組出的字串能通過
  `next/image` 的 URL 解析就不會 500（實際圖片會 404，但那是預期中「本機無 MinIO」的
  限制，不影響頁面本身渲染）。
