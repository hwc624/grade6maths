# 六年級學習站：數學 ＋ 自然科學與技術

單一頁面 `index.html`。數學維持原本的互動練習；自然科學與技術（NS&T，南非 CAPS 六年級）的課文在 `nst-lessons.json`，換檔即可，不必改程式。

沒有建置步驟、沒有帳號、沒有 API 金鑰。孩子的作答和「待補充問題」只存在這台裝置的 `localStorage`，不會送到任何伺服器。

## 預覽

請用網頁伺服器開啟（直接雙擊 `index.html` 時，瀏覽器會擋住 JSON）：

```bash
python3 -m http.server 8765
```

打開 <http://127.0.0.1:8765/>。科目開關在主題格子上方：**數學 Maths**｜**自然科學 NS&T**。右上角可切換中文／English。

NS&T 流程：選單元 → 分段課文（中文說明，下面是英文考試句；有 `diagram_hint` 時顯示「圖示」說明，不產生圖片）→ 練習題。按 **我不懂** 會先問一句「卡在哪裡」，再列出這個單元的常見困惑，也可以在 **我自己寫** 打一句話。

困惑一次只顯示一層：更簡單的說法 →（還是不懂）生活比喻 →（還是不懂）再更慢一次。隨時可以按 **我懂了，考考我**。確認題答錯會顯示 `why_zh`，並可以再看下一層；最後一層還是不對，就建議問爸爸或老師。確認題由程式對答案，不由 AI 批改。

自由輸入先用該困惑的 `keywords`（英文會先轉成小寫）對應；沒有對上再用 `label_zh` 和本單元 `key_terms`。仍然對不上就顯示「問爸爸或老師」，並把句子存在這台裝置。頁面下方 **家長：待補充的問題** 可以查看、複製或清除，沒有姓名。

`notes` 不顯示。`flagged_facts` 只放在該單元收合的 **給家長** 裡。

## 裝置上的 AI（可有可無）

只在進入 NS&T 時偵測 Chrome 的 [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)（`LanguageModel`，Gemini Nano）。`availability()` 和之後的 `create()` 使用同一組選項：輸入與輸出都是英文（`en`）。這個 API 不支援中文。

- 沒有 API，或結果是 `unavailable`：不顯示任何 AI 介面，課文照常。
- `downloadable` 或 `downloading`：顯示 **啟用 AI 小老師（需下載數 GB，請用 Wi-Fi）**。只有按下按鈕才呼叫 `LanguageModel.create({ monitor })`，並用 `downloadprogress` 的 `loaded` 畫進度。失敗時課文仍可用。
- `available`：孩子在「我自己寫」送出後，用串流（`promptStreaming`）給一段簡單英文。內容只根據**目前這個單元**的 `key_terms`、`explanation_steps`、`confusions`。教學規則在 `index.html` 的 `NST_AI_SYSTEM_PROMPT`，改那段文字即可。

## 檢查

需要本機的 Google Chrome：

```bash
node test/nst-ai-mock.mjs
```

這支測試會用假的 `LanguageModel` 走 `available`、`downloadable`、`downloading`、`unavailable` 和「沒有 API」，並檢查幾個自由輸入會對上哪一個困惑。

## `nst-lessons.json` 格式

最外層：

| 欄位 | 說明 |
| --- | --- |
| `meta` | 標題、對象、免責聲明。頁首用短標題；`title_zh` / `title_en` 與 `disclaimer_zh` 顯示在單元清單。`how_the_site_should_use_this_zh` 只給編輯的人看，頁面不顯示。 |
| `ask_what_confused` | 物件。`intro_zh` 是「我不懂」的開場；`prompts_zh` 每次輪流顯示一句；`encouragement_zh`、`follow_up_zh`、`if_still_stuck_zh` 用在再講解與問家長。也接受字串陣列（每一句當一個 prompt）。 |
| `flagged_facts` | `{ id, units: [單元 id], note_zh, note_en }`。只出現在相關單元收合的「給家長」。 |
| `units` | 單元陣列。這一版有 10 個。 |

每個單元：

| 欄位 | 顯示 |
| --- | --- |
| `id` | 網址與程式用，不顯示。例如 `unit-01-circuits`。 |
| `title_zh`, `title_en` | 中文模式以中文為主、英文為副；English 模式相反。 |
| `term` | 單元清單的分組標題，例如 `Term 3: Energy and Change`。 |
| `key_terms` | `{ en, zh, kid_definition_zh }`。關鍵詞清單：英文、中文、給孩子的定義。 |
| `explanation_steps` | `{ id?, zh, en_exam_sentence?, diagram_hint? }`。中文模式先顯示 `zh`，底下是英文考試句。English 模式先顯示考試句，沒有則用 `zh`。`diagram_hint` 是英文圖說，放在「圖示」框，沒有圖檔。 |
| `check_questions` | `{ id?, q_en, q_zh, options, answer, why_zh }`。`options` 已含選項字母，例如 `"B  a battery"`，`answer` 必須等於其中一整句。有 `id` 就用（例如 `u1-q1`），沒有就編成 `` `${unit.id}-q${n}` ``。答完顯示 `why_zh`。 |
| `confusions` | 見下方。 |
| `exam_tips_zh`, `common_mistakes_zh` | 字串或字串陣列，放在單元最後。 |
| `notes` | 給編輯的人，**不顯示**。 |

每個困惑：

| 欄位 | 說明 |
| --- | --- |
| `id` | 例如 `u1-c1`。 |
| `label_zh` | 清單上的按鈕文字。 |
| `keywords` | 選填。字串陣列，中英混合，英文請用小寫。自由輸入時**最先**用這些詞對應（孩子的句子會先轉成小寫）。 |
| `simpler_explanation_zh` | 第 1 層。 |
| `analogy_zh` | 第 2 層（生活例子）。 |
| `even_simpler_zh` | 第 3 層。 |
| `confirm_question` | `{ q_zh, options, answer, why_zh }`。規則與練習題相同。 |

自由輸入若沒有任何 `keywords` 對上，才改看 `label_zh`，以及這個單元 `key_terms` 的英文／中文是否出現在該困惑的說明裡。

```json
{
  "meta": { "title_zh": "…", "title_en": "…", "disclaimer_zh": "…" },
  "ask_what_confused": {
    "intro_zh": "沒關係，我們慢慢來。…",
    "prompts_zh": ["剛才哪個英文詞你覺得最陌生？"],
    "encouragement_zh": "…",
    "follow_up_zh": "…",
    "if_still_stuck_zh": "…"
  },
  "flagged_facts": [
    { "id": "moon-period", "units": ["unit-08-moon"], "note_zh": "…", "note_en": "…" }
  ],
  "units": [
    {
      "id": "unit-01-circuits",
      "title_en": "Electric circuits and circuit symbols",
      "title_zh": "電路和電路符號",
      "term": "Term 3: Energy and Change",
      "notes": [],
      "key_terms": [{ "en": "cell", "zh": "單電池／一顆電池", "kid_definition_zh": "…" }],
      "explanation_steps": [{ "id": "u1-s1", "zh": "…", "en_exam_sentence": "…", "diagram_hint": "…" }],
      "check_questions": [{ "id": "u1-q1", "q_en": "…", "q_zh": "…", "options": ["A  …", "B  …"], "answer": "B  …", "why_zh": "…" }],
      "confusions": [{
        "id": "u1-c1",
        "label_zh": "電池跟電池組有什麼不一樣？",
        "keywords": ["電池", "cell", "battery"],
        "simpler_explanation_zh": "…",
        "analogy_zh": "…",
        "even_simpler_zh": "…",
        "confirm_question": { "q_zh": "…", "options": ["A  a cell", "B  a battery"], "answer": "B  a battery", "why_zh": "…" }
      }],
      "exam_tips_zh": ["…"],
      "common_mistakes_zh": ["…"]
    }
  ]
}
```

JSON 讀取時會檢查必要欄位。格式不對時，NS&T 顯示錯誤說明，數學練習不受影響。
