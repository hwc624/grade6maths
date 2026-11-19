# 工程筆記（2026-11-19 更新）

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

- `main` = 線上版（`0a42f86`：朗讀按鈕）。
- `geo-subject`（本機、未推）：新增地理科目，worktree 在 `/workspace/grade6maths-geo`。
- `tts-zh-numbers`（本機、未推）：`index.html` 有一段**未提交**的修改（中英夾雜時數字用哪種語言唸）。Hans 說先保留不要動。
- `area-perimeter`、`improve-practice`：舊的本機分支，已完全併入 `main`，未清理。
- `tts-preview`：舊的本機朗讀預覽，有 1 個 commit（`6434f20`）不在 `main`；朗讀功能已用 PR #2 另外上線（推論：此分支已被取代），未清理。

## 測試

```bash
python3 -m http.server 8765        # 手動預覽 http://127.0.0.1:8765/
node test/nst-ai-mock.mjs          # NS&T 與假的 Prompt API（需要 google-chrome）
node test/geo-subject.mjs          # 地理 + 數學/NS&T 回歸 + 390px
```

兩支測試都可以用 `ARTIFACTS_DIR=/某資料夾` 指定截圖位置。

## 已知問題 / 待辦

- 手機寬度（約 390px）三個科目按鈕排成兩列：「社會 Geography」單獨一列、全寬。沒改樣式，留給設計師決定。
- 朗讀按鈕的 id 前綴仍叫 `nst-…`，地理也共用；功能正常，只是命名。
- `geo-lessons.json` 有幾個關鍵字同時出現在同一單元的兩個困惑（例如 `price`、`原料`、`盎司`、`sahara`、`kimberley`、`城市`、`步驟`），只打這個詞時會選分數較高/較前面那個。每個困惑仍可用自己的其他關鍵字對上（測試有檢查）。
- 地理的 `flagged_facts` 有 10 條（課本數字前後不一、印錯、圖表估讀值等），家長看「給家長」即可。
- Prompt API 不支援中文，AI 只回簡單英文。
