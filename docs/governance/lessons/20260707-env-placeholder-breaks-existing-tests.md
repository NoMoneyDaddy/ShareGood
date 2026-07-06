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
