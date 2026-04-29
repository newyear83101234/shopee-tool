# 蝦皮快速上架助手 — Claude Code 開發文件

## 專案概述

Chrome 擴充功能（Manifest V3），用於蝦皮多帳號快速上架。從 A 帳號擷取商品資料，自動填入 B~E 帳號，AI 自動生成不同標題避免重複上架偵測。

**使用者：** 阿葉（葉子小舖），台南歸仁，經營蝦皮 + 酷澎電商，倉庫團隊 10+ 人。
**語言：** 所有回覆、commit message、註解請使用**繁體中文**。

---

## 檔案結構

```
shopee-tool/
├── manifest.json          # Manifest V3，版本 4.1.0
├── popup.html             # 擴充功能彈出視窗 UI
├── install.bat            # Native Host 安裝腳本（純 ASCII，呼叫 Python）
├── js/
│   ├── content.js         # 核心邏輯（~1891 行）：擷取 + 填入商品資料
│   ├── popup.js           # 彈出視窗邏輯（~523 行）：UI 控制 + AI 標題生成
│   └── background.js      # Service Worker（~47 行）：Native Host 通訊轉發
├── css/
│   ├── popup.css          # 彈出視窗樣式
│   └── content.css        # Content Script 樣式（目前幾乎空白）
├── native-host/
│   ├── shopee_helper_host.py   # Native Host 主程式（精簡版，56 行，只做 JSON 讀寫）
│   ├── shopee_helper_host.bat  # 啟動器
│   ├── install_helper.py       # 安裝輔助（收集 Extension ID，產生 JSON config）
│   └── com.shopee.helper.json  # Chrome Native Messaging config
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 核心架構

### 資料流

```
A 帳號（蝦皮賣家中心）
  → content.js 擷取商品資料（名稱、描述、分類、規格、價格、屬性、物流）
  → 透過 chrome.runtime.sendMessage 傳給 background.js
  → background.js 透過 Native Host 存到 D:\shopee-data\product.json
  → 同時也存 chrome.storage.local（fallback）

B~E 帳號
  → popup.js 從 Native Host 讀取（優先）或 chrome.storage.local 讀取
  → 使用者點「開始填入」
  → content.js 接收資料，自動填入蝦皮表單
```

### 跨 Profile 資料共享（Hybrid Storage）

```javascript
// popup.js 的雙重儲存策略
async function sharedSave(nativeAction, localKey, data) {
  await chrome.storage.local.set({ [localKey]: data });  // 一定存 local
  if (nativeConnected) {
    try { await sendNative({ action: nativeAction, data }); } catch(e) {}
  }
}

async function sharedLoad(nativeAction, localKey) {
  if (nativeConnected) {
    try {
      const res = await sendNative({ action: nativeAction });
      if (res.data) { await chrome.storage.local.set({ [localKey]: res.data }); return res.data; }
    } catch(e) {}
  }
  const local = await chrome.storage.local.get([localKey]);
  return local[localKey] || null;
}
```

- **Native Host 可用**：跨 Chrome Profile 共享（存到 `D:\shopee-data\`）
- **Native Host 不可用**：降級為同 Profile 內使用（`chrome.storage.local` 是 Profile 隔離的）
- 未連線時顯示**黃色提示條**（非阻斷性）

### Native Host 資料路徑

```python
DATA_DIR = r"D:\shopee-data"
FILE_MAP = {
    'load_settings': 'settings.json',
    'save_settings': 'settings.json',
    'load_product': 'product.json',
    'save_product': 'product.json',
    'load_titles': 'titles.json',
    'save_titles': 'titles.json',
}
```

---

## content.js 功能模組

### 擷取（A 帳號）

| 功能 | 函式 | 說明 |
|------|------|------|
| 商品名稱 | `captureProductName()` | 從 input 讀取 |
| 商品描述 | `captureDescription()` | 回傳 `{ html, text }`，html 保留原始排版 |
| 分類 | `captureCategory()` | 讀取分類麵包屑文字 |
| 規格/款式 | `captureVariations()` | 支援單規格、雙規格 |
| 價格表 | `capturePricingTable()` | 含 price, stock, sku, variantName |
| 屬性 | `captureAttributes()` | 含 type（single-select/multi-select/text-input/date）、unit |
| 物流 | `captureLogistics()` | 已開啟的物流方式名稱列表 |

### 填入（B~E 帳號）

| 功能 | 函式 | 關鍵細節 |
|------|------|---------|
| 商品名稱 | `fillProductName()` | `setNativeValue()` 觸發 React/Vue 狀態更新 |
| 商品描述 | `fillDescription()` | 優先用 `innerHTML`（保留格式），fallback 用 `<br>` 換行 |
| 分類 | `fillCategory()` | 逐層點擊分類樹，最後點「編輯分類」modal 裡的確認按鈕 |
| 規格 | `fillVariations()` | 自動點「開啟商品規格」→ 填規格名稱 → 填選項 |
| 價格表 | `expandAndFillPricing()` | 展開隱藏行 → 逐行填入 price/stock/sku |
| 屬性 | `fillAttributes()` | 處理下拉選單、文字輸入、多選、**單位選擇器** |
| 物流 | `fillLogistics()` | 開關物流 → 自動確認物流彈窗 |

---

## 已解決的重大 Bug（開發時務必留意）

### 1. 分類確認按鈕找錯元素

**問題：** 頁面有 14 個隱藏的 `.eds-modal__box`，`querySelector` 總是抓到第一個（隱藏的「儲存」按鈕），不是分類彈窗的「確認」按鈕。

**解法：** 找到標題為「編輯分類」的 modal，從裡面找確認按鈕：
```javascript
const allModals = document.querySelectorAll('.eds-modal__box');
for (const modal of allModals) {
  const title = modal.querySelector('.eds-modal__title');
  if (title && title.textContent.trim().includes('編輯分類')) {
    // 在這個 modal 裡找確認按鈕
  }
}
```

**教訓：** 蝦皮頁面有大量隱藏 modal，永遠不要用 `querySelector` 找第一個匹配。要用 `getBoundingClientRect()` 檢查可見性，或用標題/文字內容精確定位。

### 2. 物流確認按鈕誤點「儲存」

**問題：** 跟分類一樣，`dismissLogisticsConfirmDialog()` 找到隱藏 modal 的 primary 按鈕。

**解法：** 只處理包含物流相關文字（運費、宅配、超商、店到店、開啟此物流）的**可見** modal。用 `getBoundingClientRect().width > 0` 判斷可見性。

### 3. 單位選擇器（CM/ML/KG）

**問題：** 下拉選項的 class 是 `.eds-option`（在 `.eds-select__options` 裡），不是一般的 `.eds-selector-dropdown__item`。

**解法：**
```javascript
const options = document.querySelectorAll('.eds-option, .eds-select__options .eds-option');
```

### 4. 商品描述格式跑掉

**問題：** 擷取用 `innerText`（純文字），填入時每行包成 `<p>` → 行距變大。

**解法：** 擷取時保存 `{ html: editor.innerHTML, text: editor.innerText }`，填入時優先用 `innerHTML` 直接注入。

### 5. 跨 Profile 資料共享

**問題：** `chrome.storage.local` 是 per-Profile 隔離的，A 帳號存的資料 B 帳號讀不到。

**解法：** Native Host（Python）讀寫 `D:\shopee-data\` 的 JSON 檔案，所有 Profile 都能存取。

### 6. install.bat 中文亂碼

**問題：** BAT 檔中文字元導致「不是內部或外部命令」。

**解法：** BAT 檔改用純 ASCII 英文提示，Python 腳本處理邏輯。

### 7. 多 Extension ID

**事實確認：** 同一個擴充功能在不同 Chrome Profile 下的 Extension ID **是相同的**（解壓載入時）。`install.bat` 只需輸入一次 ID。

---

## 蝦皮賣家中心 DOM 結構重點

### 表單元素

| 元素 | Selector | 用途 |
|------|----------|------|
| 文字輸入 | `input.eds-input__input` | 商品名稱、屬性文字值 |
| 下拉選單 | `.eds-selector` | 品牌、保固等 single-select |
| 下拉選項 | `.eds-option` | 在 `.eds-select__options` 內 |
| 多選選項 | `.eds-checkbox` | 材質等 multi-select |
| 富文本編輯 | `.ql-editor, [contenteditable="true"]` | 商品描述 |
| 屬性區塊 | `.attribute-select-item` | 每個屬性欄位的容器 |
| 單位選擇器 | `.listing-unit-input-unit .eds-selector` | 包裝尺寸旁的 CM/ML/KG |

### Modal / 彈窗

| 彈窗 | 識別方式 | 注意 |
|------|----------|------|
| 分類選擇 | `.eds-modal__title` 包含「編輯分類」 | 有 14+ 隱藏 modal，不能用 querySelector 第一個 |
| 物流確認 | 文字包含「運費/宅配/超商/物流」 | 按鈕可能是「確認」「開啟此物流方式」「確認送出變更」 |
| 分類確認按鈕 | `eds-modal__footer-buttons` 裡的 `.eds-button--primary` | disabled 狀態 → 選完最底層分類後才啟用 |

### setNativeValue — 填入 React/Vue 表單的核心函式

```javascript
function setNativeValue(element, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeInputValueSetter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
```

直接設定 `.value` 不會觸發 React/Vue 的狀態更新，必須用原生 setter + dispatch event。

---

## popup.js 功能

### AI 標題生成

- 使用 **Gemini API**（`gemini-2.0-flash`）
- API Key 存在 `chrome.storage.local`（使用者在設定頁輸入）
- 4 種風格：標準電商、活潑可愛、專業簡潔、高端質感
- 從 background.js 透過 `fetch` 呼叫（避免 CORS）
- 生成 4 組不同標題供 4 個帳號使用

### UI 結構

```
步驟 1：從 A 帳號擷取商品資料
步驟 2：AI 生成不同標題（可選）
步驟 3：選擇帳號 → 開始填入

Tab：資料填入 | 標題管理 | 已擷取資料（顯示擷取到的完整資料預覽）

設定區：Gemini API Key、自動儲存開關、填入速度
```

---

## 安裝流程

1. 解壓 ZIP → 5 個 Chrome Profile 都到 `chrome://extensions/` → 載入未封裝項目
2. 複製任一個 Profile 的 Extension ID
3. **以系統管理員身份**雙擊 `install.bat`
4. 貼上 Extension ID → 按 Enter
5. 重啟所有 Chrome 視窗

**前提：** Python 3 已安裝且加入 PATH

---

## 目前功能狀態

| 功能 | 狀態 | 備註 |
|------|------|------|
| 跨 Profile 資料共享 | ✅ | Native Host + local fallback |
| 商品名稱/描述 | ✅ | 描述保留 HTML 格式 |
| 分類自動選擇 | ✅ | 逐層點擊 + 自動確認 |
| 單規格/雙規格 | ✅ | |
| 價格表展開填入（36行+）| ✅ | |
| 屬性填入 | ✅ | 含單位選擇器（CM/ML/KG） |
| 物流開關 | ✅ | 自動確認彈窗 |
| AI 標題生成 | ✅ | Gemini API |
| 圖片上傳 | ❌ | 待開發（手動） |

---

## 待開發功能

### 圖片自動上傳（優先）

- 商品主圖（cover images）：需要自動上傳到 file input
- 規格縮圖（spec thumbnails）：每個規格選項的小圖
- 可能需要 Native Host 讀取本地圖片檔案路徑
- 蝦皮的 file input 可能需要特殊處理（DataTransfer API）

### 其他潛在改進

- 填入進度條 / 狀態顯示優化
- 錯誤處理強化（目前某些失敗是靜默的）
- 支援「編輯商品」頁面（目前主要針對「新增商品」）
- 批次上架流程

---

## 開發注意事項

1. **測試時永遠用蝦皮賣家中心的「新增商品」頁面**：`https://seller.shopee.tw/portal/product/new`
2. **蝦皮會 A/B test**：不同帳號可能看到不同版本的 UI，DOM 結構可能不同
3. **不要用 `document.querySelector` 找 modal/按鈕**：頁面有大量隱藏 modal，必須用可見性檢查或標題匹配
4. **填入 React/Vue 表單必須用 `setNativeValue`**：直接設 `.value` 無效
5. **下拉選項在 `.eds-option`**：不是一般的 dropdown item class
6. **content.js 是最大最複雜的檔案**（1891 行）：修改時注意函式間的依賴關係
7. **Native Host 只需 install 一次**：除非 Extension ID 改變
