# Zeabur CLI 三個坑：create 不覆寫變數、旗標名不一致、互動模式會卡死自動化

- 日期：2026-07-05
- 情境：M0 部署，用 `npx zeabur@latest` 操作服務、變數、網域
- 症狀與修法（三件事）：
  1. **`variable create` 對既有 key 靜默不覆寫**（exit 0 但值沒變）。改值一律用
     `variable update`。發現方式：改完 `variable list` 對值，不要相信 exit code。
  2. **旗標名子指令間不一致**：`service list` 用 `--project-id`、`variable list` 用 `--id`、
     `deployment log` 用 `--service-id`、`service exec` 也用 `--id`。每個子指令先 `--help`
     再用，不要套用上一個指令的旗標。
  3. **預設互動模式**：沒給齊參數會跳互動式提問，在無 TTY 環境直接 EOF 失敗。自動化一律加
     `-y --interactive=false`；`-k key=value` 的 value 含 `=`（如 base64）會解析失敗，
     secret 用 hex 格式避開。
- 其他有用事實：token 從環境變數自動讀取（不用 auth login）；`template deploy -c <代碼>
  --project-id <id>` 是建 prebuilt 服務最可靠的路；同專案服務的 exposed 變數會自動注入
  兄弟服務（`${POSTGRES_CONNECTION_STRING}` 直接引用）；變數改動會自動觸發重建。
