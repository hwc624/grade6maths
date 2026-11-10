# 本機筆記（朗讀預覽）

- 分支 `tts-preview` 只在本機，還沒推上 GitHub，線上網站未改。
- 朗讀用瀏覽器內建 Web Speech API（`speechSynthesis`），不上網、不用金鑰。沒有 API 或沒有語音時，按鈕會隱藏。
- 中文優先 `zh-TW`（沒有就用其他 `zh-*`）；英文優先 `en-ZA`，再來 `en-GB` / `en-US`。語速 0.9。中英混寫會依文字分段換聲音。
- Windows 要有已安裝的中文語音，Chrome 才能用中文唸（這台是 Windows 11 + Chrome 156）。下一步：Hans 在本機預覽確認後，再說「推」才會更新線上版。
