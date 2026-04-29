# 蝦皮快速上架助手

葉子小舖內部工具：蝦皮多帳號商品快速上架（Chrome 擴充功能）。

## 最新版本下載

員工請使用桌面的「**更新蝦皮工具.bat**」一鍵更新；
若沒有，請至：[Releases - latest](../../releases/tag/latest) 下載 `shopee-tool.zip`。

## 目錄
- `js/` — content.js / popup.js / background.js
- `popup.html` — 擴充功能彈出視窗
- `native-host/` — Native Messaging Host（跨 Chrome Profile 共享資料）
- `install.bat` — 首次安裝的 Native Host 註冊腳本
- `更新蝦皮工具.bat` — 員工專用，從 GitHub Release 下載最新版

## 首次安裝（員工）
1. 解壓 `shopee-tool.zip` 到 `D:\shopee-tool`
2. `chrome://extensions/` → 開啟「開發者模式」→ 點「載入未封裝項目」→ 選 `D:\shopee-tool`
3. 複製顯示出的 Extension ID
4. 以系統管理員身份雙擊 `install.bat`，貼上 ID
5. 重啟 Chrome

## 後續更新（員工）
雙擊桌面「**更新蝦皮工具.bat**」即可。
