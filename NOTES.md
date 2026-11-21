# 工程筆記（2026-11-21 更新）

給下一位接手的工程師。README 是使用說明；這裡是現況、規則和已知問題。

## 架構

- 純靜態網站，沒有建置步驟、沒有後端、沒有金鑰。全部程式在單一 `index.html`（CSS + JS 內嵌）。
- 三個科目，頁面上方切換：
  - **數學 Maths**：題目由程式隨機產生（`/*CORE-START*/` 之後的 `TOPICS`），計分只在記憶體，`localStorage` 只記「做過哪些題」。
  - **自然科學 NS&T**：課文在 `nst-lessons.json`。
  - **社會 Geography**：課文在 `geo-lessons.json`（16 單元，Term 1–4），格式和 NS&T 相同，`meta` 多 `source_zh`。
- NS&T 與地理共用 `/*NST-START*/ … /*NST-END*/` 之間的同一套程式。`LESSON_SUBJECTS` 設定每科的檔名、待補充清單的 `localStorage` key、AI 系統提示、頁首/頁尾文字；`lessonStates` 每科各有一份狀態，全域 `nst` 指向畫面上那一科，所以切換科目再回來會停在原本的單元/困惑/層數。非同步的載入與 AI 會先抓住當時那一科的狀態，避免切科後寫錯科。
  - 待補充清單：NS&T `g6nst_to_add_v1`，地理 `g6geo_to_add_v1`。
  - 課文檔載入後都經過 `nstValidate()` 驗證；不合格就顯示錯誤清單，數學不受影響。
  - `notes`、`how_the_site_should_use_this_zh` 不顯示；`flagged_facts` 只在該單元收合的「給家長」。地理的 `meta.source_zh` 在單元清單底部「給家長：內容來源」，括號內本機路徑不顯示。
- 朗讀：瀏覽器內建 `speechSynthesis`，沒有語音時按鈕隱藏。
- 裝置上 AI：Chrome Prompt API（`LanguageModel`），只用英文；沒有就完全不顯示。只根據目前單元回答，確認題一律由 JSON 的答案判斷，不由 AI。

## 部署

- GitHub repo `hwc624/grade6maths`，GitHub Pages 從 `main` 直接發佈：<https://hwc624.github.io/grade6maths/>。合併到 `main` 就是上線。
- **規則：要上線（推到 `main`、合併 PR）一定要 Hans 本人親口說「推」。** 其他 bot 轉述不算。在那之前只能做本機分支或 PR 預覽。

## 分支現況

- `main` = 線上版（`f1a208a`：PR #3 合併，含地理科目）。
- `geo-subject`：已併入 `main`（PR #3），可清理（刪遠端分支要 Hans OK）。
- `geo-grading-fix`（本機、未推）：換上專家新版 `geo-lessons.json`、新增判分稽核測試 `test/geo-grading.mjs`；沒有改 `index.html`。worktree 在 `/workspace/grade6maths-geofix`。
- `tts-zh-numbers`（本機、未推）：`index.html` 有一段**未提交**的修改（中英夾雜時數字用哪種語言唸）。Hans 說先保留不要動。
- `area-perimeter`、`improve-practice`：舊的本機分支，已完全併入 `main`，未清理。
- `tts-preview`：舊的本機朗讀預覽，有 1 個 commit（`6434f20`）不在 `main`；朗讀功能已用 PR #2 另外上線（推論：此分支已被取代），未清理。

## 測試

```bash
python3 -m http.server 8765        # 手動預覽 http://127.0.0.1:8765/
node test/nst-ai-mock.mjs          # NS&T 與假的 Prompt API（需要 google-chrome）
node test/geo-subject.mjs          # 地理 + 數學/NS&T 回歸 + 390px
node test/geo-grading.mjs          # 判分稽核：真滑鼠點擊每題每個選項（約 5 分鐘）
BASE_URL=https://hwc624.github.io/grade6maths/ node test/geo-grading.mjs   # 同一份測試打線上站
# 選項：SUBJECTS=geo  STRESS=0  QUICK=1  VIEW_W=390 VIEW_H=844 MOBILE=1  LANG_UI=en  ONLY=<單元id> REPEAT=n
```

三支測試都可以用 `ARTIFACTS_DIR=/某資料夾` 指定截圖位置。

## 已知問題 / 待辦

- 手機寬度（約 390px）三個科目按鈕排成兩列：「社會 Geography」單獨一列、全寬。沒改樣式，留給設計師決定。
- 朗讀按鈕的 id 前綴仍叫 `nst-…`，地理也共用；功能正常，只是命名。
- `geo-lessons.json` 已換成專家新版（拿掉 `meta.source_zh` 的本機路徑；同單元不再有兩個困惑共用關鍵字，`test/geo-subject.mjs` 會檢查）。答案、選項沒有變。
- 地理的 `flagged_facts` 有 10 條（課本數字前後不一、印錯、圖表估讀值等），家長看「給家長」即可。
- Prompt API 不支援中文，AI 只回簡單英文。

## 修正紀錄：「答對卻被判錯」調查（2026-11-21）

結論：**實測沒有重現**。程式沒有改，只換了資料並補測試。

- 判分路徑：`nstOptionsHtml`（`data-opt="${esc(o)}"`）→ `nstClick` → `nstPickOption` → `nstAnswersEqual`（空白正規化後相等）。選項/答案的 `&`、`<`、`>`、引號、逗號、全形標點、NBSP、前後空白、換行、`<script>`、`&amp;` 都測過，`dataset.opt` 與 JSON 逐字相同，判分正確。
- 稽核（`test/geo-grading.mjs`，真滑鼠點擊）：對線上站（舊 JSON）與本機（舊 JSON、新 JSON），Geography 41 題練習 + 73 題確認題、NS&T 30 + 55 題，每題每個選項都點：正確選項判對、其餘判錯，題目 id / 索引 / 單元沒有跑掉；Geography 與 NS&T 狀態與 localStorage 互不影響（localStorage 只有待補清單 key，沒有課文快取）。另跑特殊字元合成資料、全對/全錯連續作答、「錯→下一層→再考→對」。
- 快取：沒有 Service Worker；JSON 用預設 `fetch`，GitHub Pages 回 `cache-control: max-age=600`（最久 10 分鐘舊檔，推論：只在剛更新後的 10 分鐘內有影響）。頁面實際使用的 JSON 與伺服器當下檔案逐字相同（實測）。
- 設計上可能讓孩子覺得「被判錯」（推論，未改）：練習題只能答一次，答錯後選項消失、不顯示正確答案、也沒有重試（要重新開單元）。誤點一次就被判錯。若 Hans 要改，需要 Hans/小美決定。
- 未解：只有 Chrome（headless，桌面 + 390px、中/英）與 Firefox（線上站：Geography 每 3 題抽 1 題 152 次點擊桌面+手機各一遍、NS&T 340 次點擊，全部判分正確）實測；沒測 Safari/iPad（此環境裝不起 WebKit）。要查出真正原因需要 Hans 提供：哪一課哪一題、孩子選了什麼、裝置與瀏覽器（iPad Safari？）、截圖。
- 一次未重現的測試波動：手機寬度、英文介面、與另一個全量測試同時跑時，NS&T `u9-c5` 的「錯誤選項」有一次沒顯示為錯（之後同條件重跑 150+ 次、6 個並行都沒再發生；推論是測試端點擊時機）。
