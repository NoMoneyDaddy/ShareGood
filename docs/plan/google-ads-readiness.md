# Google AdSense 上架準備研究報告

> 本文件研究「ShareGood 之後接入 Google Ad（優先 AdSense）需要準備什麼」，供日後真正申請前
> 對照執行。**這不是規格文件，不會觸發實作 session**；純研究＋建議，需要寫程式碼的項目留給
> 之後對應的 milestone 去做。
>
> 查證時間：2026-07。廣告政策異動頻繁，**正式送出 AdSense 申請前，請重新用本文列出的官方
> 連結核對一次**，不要直接照本文數字執行超過半年以上未更新的版本。
> 範圍：優先 Google AdSense（個人/中小型網站標準起點）；Google Ad Manager 是給有專屬業務
> 團隊/大流量網站用的進階產品，ShareGood 現階段用不到，本文不展開。

## 0. 現況對照（寫這份文件時的 ShareGood 狀態）

- 已部署但**尚未公開上線**：https://sharegood.nomoneydaddy.app 。
- M1 核心共享主迴路（上架／留言認領／直贈／交接私訊／完成／感謝與貢獻值）剛完成，
  剩 E2E 全流程測試待補。
- M2（治理底線：檢舉／強制下架／使用者限制／關鍵字黑名單／rate limit／後台）**尚未開工**，
  是下一個 milestone。
- 另一個 agent 正在補 `/guide`／`/rules`／`/terms`／`/privacy` 四頁（分支
  `feat/guide-rules-terms-privacy-pages`）——這四頁「要不要做」已經是既定計畫，本文只談
  「這四頁的內容要滿足哪些 AdSense 具體要求」，不重複建議要做這些頁面。
- master-plan.md §3.7 已經把 SEO/AEO 慣例定案（server-render、metadata、OG、JSON-LD、
  sitemap、robots.txt），這些跟 AdSense 對「內容品質／網站架構」的要求高度重疊，等於已經
  超前部署了一部分。
- master-plan.md §12（公開試用前 gate）已經列了 Lighthouse SEO ≥ 90、Rich Results Test
  通過等項目，本文的技術要求會直接對照這份 gate，不重複發明新的檢查表格式。

---

## 1. 內容政策

### 1.1 原創內容量／內容品質：官方沒有給量化門檻

查證於 2026-07，來源：
[AdSense Program policies](https://support.google.com/adsense/answer/48182?hl=en)、
[Eligibility requirements for AdSense](https://support.google.com/adsense/answer/9724?hl=en)、
[Your AdSense account wasn't approved](https://support.google.com/adsense/answer/81904?hl=en)。

- 官方原文只講「Your content must be high-quality, original, and attract an audience」，
  **沒有列出最低頁數、最低字數、最低文章篇數這類具體數字**。這點官方沒有給量化標準，
  下面提到的頁數/字數都是業界經驗，不是 Google 明文規定。
- 官方在「帳號未核准」頁面列出的具體拒絕理由（可視為反向的品質標準）：
  - 「sites that contain mostly images, videos or Flash animations may not be approved」
    ——內容以圖片/影片為主、缺乏文字段落會被拒。
  - 「there isn't enough original, rich content that would be of value to users」
    ——內容單薄、自動產生頁面、原創性不足。
  - 網站要「provide a good user experience through clear navigation」，避免奇怪的轉址、
    強制登入牆、壞連結、過多彈窗。
- **業界經驗（非官方明文，多個 SEO/廣告代理部落格交叉重複出現的說法）**：
  Blogger 官方建議至少 15–20 篇高品質文章；多個第三方來源建議至少 20–30 篇、
  單篇 400–800 字以上。這些數字沒有 Google 官方來源佐證，僅供評估「內容量夠不夠格申請」
  的參考基準，不是硬性門檻。
- 流量門檻同樣**沒有官方最低要求**：官方沒有公布任何 pageview/UV/session 數字；
  重點是內容品質而非流量。第三方建議「申請前每日至少 100 訪客」屬經驗值，非官方規定。

**對 ShareGood 的具體檢查項目**（現在到申請前都適用）：
- [ ] 物品詳情頁不能只有一張圖＋一個 badge：標題、描述、狀態、縣市、上架時間等文字內容要
      完整（master-plan §3.7 的 JSON-LD/OG 已經要求詳情頁有完整 metadata，等於同時滿足
      這條）。
- [ ] `/guide`、`/rules`、`/terms`、`/privacy` 四頁要有實質段落內容，不能是條列式空殼
      （呼應 §1.2 的「不能是空殼頁面」規則，兩者本質是同一件事）。
- [ ] 累積到「有意義的物品上架量＋跨多個縣市的真實內容」再申請，不要在只有測試資料/
      demo 資料的狀態下申請。

### 1.2 使用者生成內容（UGC）政策：發布者對全部 UGC 負完全責任

查證於 2026-07，來源：
[User-generated content overview](https://support.google.com/adsense/answer/1355699)、
[Good strategies for managing user-generated content](https://support.google.com/adsense/answer/3011869?hl=en)、
[User-generated content forum app requirements](https://support.google.com/adsense/answer/9640027?hl=en-GB)、
[What to do if your content is flagged](https://support.google.com/adsense/answer/9652718)。

- 官方明文：「As a publisher, you're responsible for ensuring that all user-generated
  content on your site or app complies with all applicable Program policies.」
  ——ShareGood 的物品標題、描述、留言、私訊（若曾被檢舉公開）、感謝留言等全部使用者輸入內容，
  都要對 AdSense 內容政策負責，這跟平台本身是否知情無關。
- UGC 定義涵蓋很廣：「文字、留言、圖像、影片、個人資料、使用者名稱、投票、按讚或其他媒體」，
  ShareGood 的物品標題/描述/留言/感謝訊息/使用者暱稱全部算在內。
- Google 對 UGC 型網站（含 forum 類應用）視為「high risk」，可能限制或延遲廣告投放直到
  審查完成內容合規性。
- 官方建議的具體管理策略（逐條列出，供對照 ShareGood 現況）：
  1. 「Write and publish a content policy so your users know」——公開內容政策告知使用者
     什麼不能發，ShareGood 的 `/rules` 頁面正好扮演這個角色。
  2. 「add a 'Flag' or 'Report a violation' link」——檢舉連結，**這正是 M2 的檢舉功能**。
  3. 「Use a Captcha on content submission to fight back against bots」——ShareGood
     目前上架/留言表單是否有機器人防護，需要確認（master-plan 未特別提及，值得在 M2
     一併檢視）。
  4. 「Create different levels of trusted users」／「Recruit user-moderators」——信任分級
     或社群審核者，ShareGood 目前沒有，屬於加分項非必要項。
  5. 「Disable ad serving until a post is reviewed」——延遲審核後才顯示廣告，這對應
     master-plan M2 的 `REQUIRE_REVIEW` feature flag（上架進 `pending_review`）。
  6. 「Build or use an automated content filtering system」——自動過濾系統，對應 M2 的
     `keyword_blocklist`。
  7. 「Set aside some time to regularly review your top pages」——定期人工複查熱門頁面。

**關鍵判斷（回應 CLAUDE.md 交付要求裡的問題：M2 沒上線，要不要先做基本黑名單再申請）**：

- **建議：申請 AdSense 之前，至少要有「基本關鍵字黑名單攔上架標題/描述」這個最小功能上線，
  不需要等 M2 全部（檢舉→處理→下架→申訴）完整做完。**
  理由：Google 官方策略清單裡「content policy 公告」＋「自動過濾」是兩個最基礎、最低成本
  的項目，且 ShareGood 是完全開放上架（任何登入使用者皆可，無需審核）的 UGC 網站，若申請
  當下完全沒有任何內容過濾機制，一旦審查人員或 Google 的爬蟲抽到違規內容（詐騙用語、
  色情/暴力關鍵字、詐騙留言），有很高機率被判定「policy-violating content risk」而拒絕
  或延遲。
- 完整的檢舉→處理→下架→申訴 pipeline（M2 全部範圍）可以留到申請通過「之後」再補齊，
  因為那是「發生問題後的救濟流程」，不是「事前預防」，Google 審核當下看到的是網站現況
  而非流程完整度。但**「事前預防」（黑名單）建議提早，「事後救濟」（申訴流程）可以晚**。
- 具體最小可行版本建議（不寫程式碼，只列需求給日後對應 session 參考）：上架 API
  （`POST /api/items`）與留言 API 在存檔前，用一份固定關鍵字清單（詐騙、加價、色情、
  違禁品等常見樣態）做 server-side 字串比對，命中就擋下或標記待審，不需要 M2 整套後台
  UI 或 `feature_flags` 機制。

**具體檢查項目**：
- [ ] `/rules` 頁面要明確列出禁止上架的品項（違禁品、詐騙、色情、需食品安全規範的即期食品
     etc.，這點也呼應 master-plan §12 gate 提到的「禁止品項含食品規範」）。
- [ ] 上架與留言至少有 server-side 關鍵字黑名單過濾（M2 全套之前的最小版本）。
- [ ] 確認站內是否已有基本防機器人機制（表單 rate limit 或 CAPTCHA），沒有的話列入
     M2 待辦一併處理。

---

## 2. 技術要求

### 2.1 ads.txt

查證於 2026-07，來源：[Ads.txt guide](https://support.google.com/adsense/answer/12171612?hl=en)、
[Ads.txt FAQs](https://support.google.com/adsense/answer/9785052)。

- 格式：純文字檔，檔名固定 `ads.txt`，每行一筆授權賣方紀錄，格式為
  `<系統網域>, <發布商ID>, <關係類型>, <認證ID(選填)>`。
  Google/AdSense 帳號範例：
  ```
  google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
  ```
  （`pub-0000000000000000` 換成 ShareGood 實際的 AdSense publisher ID）。
- 放置位置：**網站根目錄**，例如 `https://sharegood.nomoneydaddy.app/ads.txt`
  （不是子路徑）。Next.js 專案通常放 `public/ads.txt` 讓框架直接以靜態檔案服務即可，
  這是實作細節，等真的申請到帳號、拿到 publisher ID 之後才需要動手做。
- 非強制但官方強烈建議設置：「Use of ads.txt is not mandatory, but it's highly
  recommended」——沒有 ads.txt 不會擋審核，但廣告收益可能受影響（防偽造廣告位）。
- **時序提醒**：ads.txt 需要實際的 publisher ID 才能填內容，等於是「申請通過拿到帳號後」
  才能做的事，不是現在能提前準備的項目（可以提前知道要放在 `public/` 底下即可）。

### 2.2 網站不能是空殼／施工中頁面

查證於 2026-07，來源：[Google Publisher Policies](https://support.google.com/adsense/answer/10502938?hl=en)。

- 官方明文：「We do not allow Google-served ads on screens without publisher-content or
  with low-value content, that are under construction」——空頁、低價值頁、施工中頁面
  不得放廣告（等於這些頁面存在的話，會被判定為不合格內容，即使不放廣告在該頁上）。
- 也禁止「用於警示、導覽或行為用途的頁面」單獨放廣告、以及背景執行的頁面/App。

**檢查項目**：
- [ ] 全站不能有「敬請期待」「建置中」字樣的公開頁面；若 `/guide`／`/rules` 等頁面還沒寫完，
     寧可先不公開連結，也不要放一個空殼佔位頁面上線。
- [ ] 404／權限不足等錯誤頁面要正常呈現內容，不要是裸露的框架錯誤畫面。

### 2.3 廣告擺放政策

查證於 2026-07，來源：[Ad placement policies](https://support.google.com/adsense/answer/1346295?hl=en)。

- 廣告只能標示為「Advertisement」或「Sponsored Links」（中文對應「廣告」或「贊助連結」），
  不可用「資源」「推薦連結」等模糊字眼混淆使用者。
- 禁止讓廣告在視覺上與網站原生內容（選單、導覽列、下載連結）混淆——不可用相同的框線/字體
  刻意讓廣告看起來像是內容。
- 禁止把特定圖片跟廣告刻意關聯，讓使用者誤以為圖片是廣告內容的一部分。
- 廣告不能蓋住或緊鄰導覽/操作元件（`overlay or are adjacent to navigational or other
  action items`），也不能做出「死胡同頁面」（dead end screen：使用者除了點廣告以外無法
  離開的頁面）。
- 廣告開新視窗、彈出視窗需使用者主動觸發才行，不可自動彈出。
- **廣告密度**：官方頁面文字裡沒有再列出具體的「單頁最多幾則廣告」數字（Google 在 2016
  年後已取消舊版「每頁最多 3 則」的硬性規定），現行原則是交給 Better Ads Standards／
  使用者體驗判斷，而非固定則數。這點官方沒有給量化標準，**建議 ShareGood 之後真的上廣告時
  採保守密度**（例如列表頁每 10-15 個物品卡片間插一則，物品詳情頁最多 1-2 則），寧可少放
  也不要為了收益塞爆版面觸發「Ads Interfering」判定。

**檢查項目**（等真的要放廣告程式碼時才會用到，現在先記錄需求）：
- [ ] 之後串廣告時，廣告區塊要有明確視覺區隔（留白/分隔線），不可與物品卡片、導覽列共用
     樣式。
- [ ] 手機版尤其要注意廣告不能蓋住底部導覽列（ShareGood 有 bottom-tab 導覽，是高風險點）。

### 2.4 行動裝置相容性與導覽清晰度

查證於 2026-07，來源：[Your AdSense account wasn't approved](https://support.google.com/adsense/answer/81904?hl=en)
（「clear navigation」「good user experience」原文）。

- 官方沒有針對「行動裝置相容性」給出獨立的量化規則頁面，但在拒絕原因與 Google Publisher
  Policies 的 Better Ads Standards 段落都間接指向：網站要能在行動裝置上正常使用、
  無破版、無強制安裝/登入牆擋住內容。
- ShareGood 本身是手機優先的 bottom-tab 設計，這點目前架構上已經對齊，不需要額外調整；
  但 M2/M1 之後每次新增頁面時仍要留意行動裝置下的可用性回歸。

**檢查項目**：
- [ ] 申請前用手機瀏覽器實際走過一次上架→留言→交接→完成全流程，確認沒有破版或無法點擊
     的元件（可以搭配既有的 QA 流程一起做，不需要另開一輪測試）。

---

## 3. 隱私與同意

### 3.1 個人化廣告的使用者同意要求（EU User Consent Policy）

查證於 2026-07，來源：
[Comply with the EU user consent policy](https://support.google.com/adsense/answer/7670013?hl=en)、
[EU user consent policy（Google 公司政策頁）](https://www.google.com/about/company/user-consent-policy/)。

- 自 2024-01-16 起，**對 EEA（歐洲經濟區）、英國、瑞士的使用者投放廣告**，發布者必須使用
  「經 Google 認證且符合 IAB TCF（Transparency and Consent Framework）標準的 CMP
  （Consent Management Platform）」，可以是 Google CMP 或第三方認證 CMP；若要自建同意對話框，
  也必須額外通過 Google 官方的 CMP 認證流程才能使用，**不是自建就自動符合資格**。
- 法源依據：EU ePrivacy Directive（電子隱私指令）＋ GDPR（一般資料保護規則）。
- 具體要求：使用者必須「主動同意」（active opt-in），**不允許預先勾選的同意選項**；
  發布者要清楚揭露會蒐集/使用個人資料的每一個對象（廣告技術提供商清單），並附上各自的
  說明連結。
- 未使用認證 CMP 的流量只能投放非個人化廣告或受限廣告，無法投放個人化廣告——這是「功能
  限制」而非「審核卡關」，但會直接影響廣告收益。
- **對 ShareGood 的實際適用性判斷**：ShareGood 是台灣縣市級平台，主要受眾是台灣使用者，
  短期內歐盟/英國/瑞士訪客占比應該很低，這條規則的急迫性不高；但 Google 廣告網路是全球性
  服務，網站對任何來源的訪客（含觀光客、海外台僑）都可能觸發這條規則，**建議在正式接入
  廣告時直接導入一套現成的認證 CMP（多數國際廣告聯播網有免費/低成本方案），而不是賭
  「反正沒有歐洲使用者」去跳過**，避免政策稽核風險。

### 3.2 隱私權政策要揭露使用 Google 服務蒐集/處理資料

查證於 2026-07，來源同上。

- Google 明確要求發布者在隱私權政策中「clearly identify the providers you select to
  your users」並「link to the details provided by each provider that describes their
  activities」——也就是隱私權政策必須列出使用的廣告技術提供商（至少包含 Google），
  並連結到該提供商說明資料蒐集/使用方式的頁面（Google 有提供制式的
  [Google 的資料使用方式](https://policies.google.com/technologies/partner-sites)
  這類連結可以直接引用）。
- **跟 Wave 8 隱私權政策的銜接建議**：目前 `/privacy` 頁面草擬時，如果只涵蓋 ShareGood
  自己蒐集的資料（帳號、物品資訊等），可以先不寫廣告相關條款；但建議在文件結構上預留一個
  「未來若導入廣告服務」的章節位置（可以先寫「本站目前未投放第三方廣告，若未來導入將於此
  更新並事先公告」這類前瞻性但誠實的文字），等正式申請/串接廣告時，再補上：
  1. 使用 Google AdSense／Google 廣告服務蒐集資料的說明與連結。
  2. Cookie／local storage 使用於廣告個人化的告知。
  3. 使用者可以如何選擇退出個人化廣告（連結到 Google 的
     [廣告設定](https://myadcenter.google.com/) 或瀏覽器層級的退出方式）。
  4. 若導入認證 CMP，同意橫幅/彈窗如何運作的說明。

### 3.3 台灣本地法規：個資法告知義務

查證於 2026-07，來源：[個人資料保護法第 8 條](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=I0050021)、
[個人資料保護委員會籌備處對第 8 條的說明](https://www.pdpc.gov.tw/News_Content/100/295/)。

- 個資法第 8 條要求蒐集個資時應明確告知：（1）機關/公司名稱，（2）蒐集目的，（3）個資類別，
  （4）個資利用之期間、地區、對象及方式，（5）當事人可行使的權利及方式，（6）當事人得自由
  選擇提供個人資料時，不提供將對其權益之影響。
- 若使用 cookie／類似技術蒐集可識別特定個人的資料用於廣告個人化，屬於個資法定義下的
  「蒐集」與「處理」行為；廣告投放本身則是「利用」行為——都落在個資法規範範圍內，
  **需要在隱私權政策裡完成告知義務**，這跟上面 3.2 的 Google 要求是同一件事的兩種法源
  （個資法是台灣本地強制法規，Google 政策是平台合約要求），做好 3.2 基本上就滿足了
  3.3 的告知面向，不需要另外重工。
- 業界法律意見（PwC 台灣的分析文章，非官方函釋，僅供參考）指出：目標式廣告內容與告知的
  利用目的之間應有「正當合理關聯」，否則有違法疑慮——這點沒有量化標準，屬於個案認定，
  正式上廣告前建議請台灣律師審閱隱私權政策這條（master-plan §12 gate 本來就有這條，
  廣告條款可以併入同一次法律審閱，不需要另外單獨找律師看一次）。

**檢查項目**：
- [ ] `/privacy` 頁面現在先加入「未來若導入廣告服務將於此章節更新」的前瞻性文字。
- [ ] 正式接入廣告前，隱私權政策要補上 3.2 列的四點具體條款。
- [ ] 正式接入廣告前的法律審閱（master-plan §12 既有項目）要把廣告揭露條款一併納入審查
     範圍，不用另開一輪。

---

## 4. 審核實務面：常見拒絕原因與對策

查證於 2026-07，官方來源：
[Your AdSense account wasn't approved](https://support.google.com/adsense/answer/81904?hl=en)；
交叉比對第三方近期（2026 年）經驗分享（多篇 SEO/廣告代理部落格重複出現的說法，
品質不一，僅列出多方一致提到的重點，不採信單一來源的獨門說法）。

| 拒絕原因 | 官方或多方來源怎麼說 | ShareGood 對策 |
|---|---|---|
| 重複帳號 | 官方明文一個發布者只能有一個 AdSense 帳號，共用收款人/地址/電話會被判定重複 | 用同一組負責人資訊只申請一次，不要多帳號測試 |
| 內容以圖片/影片為主，缺文字 | 官方原文「sites that contain mostly images, videos or Flash animations may not be approved」 | 物品詳情頁本來就有文字描述＋metadata，符合；避免全站變成純圖片牆 |
| 內容單薄/自動產生 | 官方原文「there isn't enough original, rich content」 | 累積真實使用者上架的物品內容，不要用假資料/佔位內容去申請 |
| 導覽不清楚、壞連結、強制登入牆 | 官方原文「clear navigation」「good user experience」 | 公開頁（首頁、列表、詳情、guide/rules/terms/privacy）不應強制登入才能看，這點需要跟現有權限設計對照確認 |
| 流量來源問題（付費點擊、垃圾流量） | 官方明文禁止 | ShareGood 目前無此類操作，維持自然流量成長即可 |
| 政策頁缺失 | 多方一致提到 Privacy Policy／Terms／About／Contact 是基本信任頁面 | Wave 8 四頁完成後即涵蓋（`/terms` `/privacy` `/rules`；`/guide` 可視為 About 的角色） |
| 網域太新 | **官方沒有公開的域名年齡門檻**，這是社群討論中反覆出現但無官方來源佐證的說法 | 不確定項目，不建議把「等網域滿 X 個月」當成申請前提，優先看內容與流量成熟度即可 |
| 版面設計問題（廣告位置、彈窗過多） | 對應第 2.3 節廣告擺放政策 | 等真正串接廣告程式碼時再依 2.3 檢查表執行 |
| 2026 年整體審核趨嚴（AI 產生內容、E-E-A-T） | 多篇 2026 年第三方文章提到 Google 對「helpful content」與 AI 內容審查更嚴格，但沒有找到 Google 官方在 AdSense 政策頁面上針對「AI 生成內容」給出獨立於一般內容品質政策之外的新規則 | ShareGood 內容主體是使用者上架的真實物品資訊，不是 AI 生成內容，這條風險相對低，但如果 `/guide` 等頁面文案是 AI 起草，記得比照 master-plan 慣例讓使用者過目、確保內容有實質價值而非空泛 AI 腔文字 |

**這張表裡標註「官方沒有公開」或「無官方來源佐證」的兩項（網域年齡、AI 內容獨立新規）
是本次查證裡明確的不確定地帶，請使用者知悉：這些是業界普遍討論但查無 Google 官方明文的
說法，不是可以照抄的硬性規定。**

---

## 5. 時間排序建議（給 ShareGood 現況的務實時間軸）

### 現在（尚未公開上線）就該做

- [ ] Wave 8 的 `/guide`／`/rules`／`/terms`／`/privacy` 四頁完成，內容要有實質段落
     （§1.1、§2.2），不能是條列空殼；`/rules` 明確列出禁止上架品項（§1.2）。
- [ ] 上架與留言加上最小可行的關鍵字黑名單過濾（§1.2 的最小版本，不需要等 M2 全套）。
- [ ] `/privacy` 加入「未來若導入廣告服務將於此更新」的前瞻性條款佔位（§3.2）。
- [ ] 全站排查沒有空殼/施工中頁面（§2.2）。
- [ ] 確認公開頁面都不需要登入即可瀏覽（呼應 §4 表格「強制登入牆」拒絕原因）。
- [ ] 這些完成後，繼續照原訂計畫走 M2 治理底線、公開試用前 §12 gate（Lighthouse SEO、
     OAuth 品牌驗證等），**廣告本身不是現階段的行動項目**。

### 等公開試用、累積真實流量與內容量之後才適合做

- [ ] 觀察一段時間的真實使用狀況：有意義的跨縣市物品上架量、真實使用者留言/交接紀錄、
     一定程度的自然流量（沒有官方數字門檻，但「只有測試資料」的狀態不該申請，§1.1）。
- [ ] M2 治理底線完整上線（檢舉→處理→下架→申訴），讓 UGC 風險控管更完整（§1.2）——
     不是申請 AdSense 的硬性前提，但強烈建議在正式廣告收益出現之前把這套風控補齊，
     降低帳號被停權的風險。
- [ ] 正式申請前重新查證本文所有連結（政策異動快，尤其 §1.1 的內容量參考值、§2.3 的
     廣告密度原則）。
- [ ] 申請通過、拿到 publisher ID 後才動手：`public/ads.txt`（§2.1）、串接廣告程式碼
     並套用 §2.3 擺放規則、依 §3.1 導入認證 CMP、依 §3.2 補完隱私權政策廣告章節。
- [ ] 隱私權政策的廣告揭露條款，併入 master-plan §12 既有的「上線前法律審閱」流程一次
     處理（§3.3），不要另外單獨找律師看一次。

---

## 參考來源清單（依查證於 2026-07 排列）

- [AdSense Program policies](https://support.google.com/adsense/answer/48182?hl=en)
- [Eligibility requirements for AdSense](https://support.google.com/adsense/answer/9724?hl=en)
- [Your AdSense account wasn't approved](https://support.google.com/adsense/answer/81904?hl=en)
- [User-generated content overview](https://support.google.com/adsense/answer/1355699)
- [Good strategies for managing user-generated content](https://support.google.com/adsense/answer/3011869?hl=en)
- [User-generated content forum app requirements](https://support.google.com/adsense/answer/9640027?hl=en-GB)
- [What to do if your content is flagged as potentially policy-violating](https://support.google.com/adsense/answer/9652718)
- [Ads.txt guide](https://support.google.com/adsense/answer/12171612?hl=en)
- [Ads.txt FAQs](https://support.google.com/adsense/answer/9785052)
- [Google Publisher Policies](https://support.google.com/adsense/answer/10502938?hl=en)
- [Google Publisher Restrictions](https://support.google.com/adsense/answer/10437795?hl=en)
- [Ad placement policies](https://support.google.com/adsense/answer/1346295?hl=en)
- [Comply with the EU user consent policy](https://support.google.com/adsense/answer/7670013?hl=en)
- [EU user consent policy（Google 公司政策頁）](https://www.google.com/about/company/user-consent-policy/)
- [中華民國個人資料保護法（全國法規資料庫）](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=I0050021)
- [個資保護委員會籌備處對第 8 條之說明](https://www.pdpc.gov.tw/News_Content/100/295/)
