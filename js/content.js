// ===== 蝦皮快速上架助手 v4 - Content Script =====
// 針對 seller.shopee.tw 的實際 DOM 結構最佳化

(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'capture') {
      captureProductData()
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.action === 'fill') {
      fillProductData(msg.data)
        .then(count => sendResponse({ success: true, filledCount: count }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.action === 'ping') {
      sendResponse({ alive: true });
      return true;
    }
  });

  // ================================================================
  //  擷取商品資料
  // ================================================================
  async function captureProductData() {
    const data = {};

    // --- 商品名稱 ---
    data.name = captureProductName();
    if (!data.name) {
      throw new Error('找不到商品名稱，請確認是否在商品新增或編輯頁面');
    }

    // --- 商品分類 ---
    data.category = captureCategory();

    // --- 商品描述 ---
    data.description = captureDescription();

    // --- 規格/款式 ---
    data.variations = captureVariations();

    // --- 銷售資訊（價格表） ---
    data.pricingTable = await capturePricingTable();
    
    // --- 規格選項備用：從 pricingTable 的 variantName 補充 ---
    if (data.variations.length > 0 && data.pricingTable.length > 0) {
      // 規格1：從 variantName 取不重複的值
      if (data.variations[0] && data.variations[0].options.length === 0) {
        const namesFromTable = [...new Set(
          data.pricingTable
            .map(row => row.variantName)
            .filter(n => n && n.trim())
        )];
        if (namesFromTable.length > 0) {
          data.variations[0].options = namesFromTable;
          console.log('[蝦皮助手] 從價格表補充規格1選項:', JSON.stringify(namesFromTable));
        }
      }
      // 規格2：從 variantName2 取不重複的值
      if (data.variations[1] && data.variations[1].options.length === 0) {
        const names2FromTable = [...new Set(
          data.pricingTable
            .map(row => row.variantName2)
            .filter(n => n && n.trim())
        )];
        if (names2FromTable.length > 0) {
          data.variations[1].options = names2FromTable;
          console.log('[蝦皮助手] 從價格表補充規格2選項:', JSON.stringify(names2FromTable));
        }
      }
    }

    // --- 無規格時的簡單價格/庫存 ---
    data.price = captureSimpleField('價格');
    data.stock = captureSimpleField('商品數量') || captureSimpleField('庫存');
    data.sku = captureSimpleField('商品選項貨號') || captureSimpleField('貨號');

    // --- 屬性 ---
    data.attributes = captureAttributes();

    // --- 物流設定 ---
    data.logistics = captureLogistics();

    // --- 重量 ---
    data.weight = captureSimpleField('重量');

    // --- 主商品貨號 ---
    data.mainSku = captureSimpleField('主商品貨號');

    return data;
  }

  // ================================================================
  //  擷取：商品名稱
  // ================================================================
  function captureProductName() {
    const selectors = [
      'input[placeholder*="品牌名稱"]',
      'input[placeholder*="商品名稱"]',
      'input[placeholder*="商品類型"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const val = el.getAttribute('modelvalue') || el.value;
        if (val) return val;
      }
    }
    return getFieldByLabel('商品名稱') || '';
  }

  // ================================================================
  //  擷取：商品分類
  // ================================================================
  function captureCategory() {
    // 分類文字在 .product-category-text span 中
    const catEl = document.querySelector('.product-category-text span');
    if (catEl) return catEl.textContent.trim();
    // 備用
    const catEl2 = document.querySelector('[class*="category-text"]');
    if (catEl2) return catEl2.textContent.trim();
    return '';
  }

  // ================================================================
  //  擷取：商品屬性（品牌、包裝款式、特殊配方等）
  // ================================================================
  function captureAttributes() {
    const attributes = [];
    
    // 找到屬性區域：.attribute-select-item 每個都是一個屬性
    const items = document.querySelectorAll('.attribute-select-item');
    
    for (const item of items) {
      const attr = {};
      
      // 取得屬性名稱
      const titleEl = item.querySelector('.item-title-text');
      if (titleEl) {
        attr.name = titleEl.textContent.trim();
      } else {
        // 品牌欄位的標題結構不同
        const labelEl = item.querySelector('.edit-label');
        if (labelEl) {
          const text = labelEl.textContent.replace('*', '').trim();
          if (text) attr.name = text;
        }
      }
      
      if (!attr.name) continue;
      
      // 判斷欄位類型並讀取值
      
      // 類型1：單選下拉 (single-selector)
      const singleSelector = item.querySelector('.single-selector .eds-selector__inner:not(.placeholder)');
      if (singleSelector && !singleSelector.classList.contains('placeholder')) {
        attr.type = 'single-select';
        attr.value = singleSelector.textContent.trim();
        if (attr.value && attr.value !== '請選擇') {
          attributes.push(attr);
          continue;
        }
      }
      
      // 類型2：多選標籤 (multiple-scroll-selector)
      const multiTags = item.querySelectorAll('.eds-selector--tag .text');
      if (multiTags.length > 0) {
        attr.type = 'multi-select';
        attr.values = Array.from(multiTags).map(t => t.textContent.trim());
        if (attr.values.length > 0) {
          attributes.push(attr);
          continue;
        }
      }
      
      // 類型3：文字輸入 (eds-input)
      const textInput = item.querySelector('.eds-input__input');
      if (textInput) {
        const val = textInput.getAttribute('modelvalue') || textInput.value || '';
        if (val) {
          attr.type = 'text-input';
          attr.value = val;
          
          // 檢查是否有單位選擇器（如 ML, KG 等）
          const unitSelector = item.querySelector('.listing-unit-input-unit .eds-selector__inner');
          if (unitSelector) {
            attr.unit = unitSelector.textContent.trim();
          }
          
          attributes.push(attr);
          continue;
        }
      }
      
      // 類型4：日期選擇器
      const dateSelector = item.querySelector('.eds-date-picker .eds-selector__inner');
      if (dateSelector) {
        const dateVal = dateSelector.textContent.trim();
        if (dateVal) {
          attr.type = 'date';
          attr.value = dateVal;
          attributes.push(attr);
        }
      }
    }
    
    console.log('[蝦皮助手] 擷取到', attributes.length, '個屬性:', JSON.stringify(attributes));
    return attributes;
  }
  function captureDescription() {
    // Quill editor
    const editors = document.querySelectorAll('.ql-editor, [contenteditable="true"]');
    for (const editor of editors) {
      if (editor.offsetParent === null) continue;
      // 確認是描述區域（不是其他編輯器）
      const section = editor.closest('[class*="description"], [class*="desc"]') ||
                      findAncestorWithText(editor, '商品描述');
      if (section || editors.length === 1) {
        // 保留 HTML 格式（用於填入時保持排版）
        const html = editor.innerHTML || '';
        const text = editor.innerText || editor.textContent || '';
        return { html, text };
      }
    }
    // textarea 備用
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.offsetParent === null) continue;
      const section = findAncestorWithText(ta, '商品描述');
      if (section) return { html: '', text: ta.value };
    }
    return { html: '', text: '' };
  }

  // ================================================================
  //  擷取：規格/款式
  // ================================================================
  function captureVariations() {
    const variations = [];
    
    console.log('[蝦皮助手] captureVariations: 開始掃描');
    
    // 策略：用「商品規格1」「商品規格2」標籤定位每個規格區塊
    // 然後在每個區塊中：第一個有值的 input = 規格名稱，其餘有值的 input = 選項
    
    // 步驟1：找所有「商品規格N」標籤元素
    const specLabels = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      const match = text.match(/^商品規格\s*(\d+)$/);
      if (match) {
        specLabels.push({ element: walker.currentNode.parentElement, index: parseInt(match[1]) });
      }
    }
    
    console.log('[蝦皮助手] 找到', specLabels.length, '個「商品規格N」標籤');
    
    if (specLabels.length === 0) {
      // 備用：沒有標籤，用 placeholder 找
      const allInputs = document.querySelectorAll('input.eds-input__input');
      for (const input of allInputs) {
        const placeholder = input.getAttribute('placeholder') || '';
        const val = input.getAttribute('modelvalue') || input.value || '';
        if ((placeholder.includes('輸入選項') || placeholder.includes('例如')) && val) {
          variations.push({ name: val, options: [] });
        }
      }
      console.log('[蝦皮助手] 備用方式結果:', JSON.stringify(variations));
      return variations;
    }
    
    // 步驟2：對每個標籤，往上找到規格區塊容器
    const specSections = []; // [{container, index}]
    
    for (const label of specLabels) {
      let container = label.element;
      // 往上找到包含 input 的容器
      for (let i = 0; i < 10; i++) {
        container = container.parentElement;
        if (!container) break;
        const inputs = container.querySelectorAll('input.eds-input__input');
        // 至少要有2個 input（1個規格名稱 + 1個以上選項）
        if (inputs.length >= 2) {
          // 確認不是整個頁面的大容器（太多 input 表示找太上層了）
          if (inputs.length < 30) {
            specSections.push({ container, index: label.index });
            console.log('[蝦皮助手] 規格', label.index, '容器 inputs:', inputs.length);
            break;
          }
        }
      }
    }
    
    // 步驟3：從每個區塊提取規格名稱和選項
    for (const sec of specSections) {
      const inputs = sec.container.querySelectorAll('input.eds-input__input');
      let specName = '';
      const options = [];
      
      for (const input of inputs) {
        const val = input.getAttribute('modelvalue') || input.value || '';
        if (!val) continue; // 跳過空 input
        
        if (!specName) {
          // 第一個有值的 input = 規格名稱
          specName = val;
        } else {
          // 後續有值的 input = 選項
          options.push(val);
        }
      }
      
      console.log('[蝦皮助手] 規格', sec.index, '「' + specName + '」選項:', JSON.stringify(options));
      if (specName) {
        variations.push({ name: specName, options });
      }
    }
    
    console.log('[蝦皮助手] captureVariations 結果:', JSON.stringify(variations));
    return variations;
  }

  // ================================================================
  //  擷取：銷售資訊（規格價格表）
  // ================================================================
  async function capturePricingTable() {
    const rows = [];
    
    let tableContainer = document.querySelector('.variation-model-table');
    if (!tableContainer) return rows;

    // 先展開所有行（點擊「查看全部」按鈕）
    // 「查看全部(26個)」可能在 table 容器外面，所以搜尋整個頁面
    let expanded = false;
    
    // 方法1：用 TreeWalker 在整個頁面搜尋包含「查看全部」的文字節點
    const expandWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (expandWalker.nextNode()) {
      const text = expandWalker.currentNode.textContent.trim();
      if (text.match(/查看全部/) && text.match(/\d+個?\)/)) {
        // 找到文字，往上找可點擊的元素
        let clickTarget = expandWalker.currentNode.parentElement;
        // 往上最多找3層，找到 <a>, <button>, 或有 click handler 的元素
        for (let up = 0; up < 3 && clickTarget; up++) {
          const tag = clickTarget.tagName?.toLowerCase();
          if (tag === 'a' || tag === 'button' || clickTarget.onclick || clickTarget.style?.cursor === 'pointer') {
            break;
          }
          clickTarget = clickTarget.parentElement;
        }
        if (clickTarget) {
          console.log('[蝦皮助手] 找到展開按鈕:', text, 'tag:', clickTarget.tagName, 'class:', (clickTarget.className || '').toString().substring(0, 40));
          clickTarget.click();
          expanded = true;
          break;
        }
      }
    }
    
    // 方法2：如果 TreeWalker 沒找到，直接搜尋所有 <a> 標籤
    if (!expanded) {
      const allLinks = document.querySelectorAll('a');
      for (const link of allLinks) {
        const text = link.textContent?.trim() || '';
        if (text.includes('查看全部')) {
          console.log('[蝦皮助手] 備用方式找到展開連結:', text);
          link.click();
          expanded = true;
          break;
        }
      }
    }
    
    if (expanded) {
      // 等待展開 - 監控 price input 數量變化
      await sleep(500);
      let prevCount = document.querySelectorAll('.variation-model-table .basic-price input.eds-input__input').length;
      console.log('[蝦皮助手] 展開前 price inputs:', prevCount);
      
      for (let w = 0; w < 8; w++) {
        await sleep(500);
        const newCount = document.querySelectorAll('.variation-model-table .basic-price input.eds-input__input').length;
        console.log('[蝦皮助手] 展開等待', w + 1, '次, price inputs:', newCount);
        if (newCount > prevCount) {
          prevCount = newCount;
          continue; // 還在增加
        }
        break; // 穩定了
      }
      console.log('[蝦皮助手] 展開完成, 最終 price inputs:', prevCount);
    }
    
    // 重新取得 tableContainer
    tableContainer = document.querySelector('.variation-model-table');
    if (!tableContainer) return rows;

    // ============================================
    // 新策略：直接找所有 price/stock/sku input
    // 不依賴 data-group（因為雙規格下 rowspan 會打亂 data-group 結構）
    // ============================================
    
    const allPriceInputs = tableContainer.querySelectorAll('.basic-price input.eds-input__input');
    const allStockInputs = tableContainer.querySelectorAll('.two-tier-basic-stock input.eds-input__input');
    const allSkuTextareas = tableContainer.querySelectorAll('.sku-textarea textarea');
    
    console.log('[蝦皮助手] 直接擷取: price=', allPriceInputs.length, 'stock=', allStockInputs.length, 'sku=', allSkuTextareas.length);
    
    const count = Math.max(allPriceInputs.length, allStockInputs.length, allSkuTextareas.length);
    
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const rowData = {};
        if (allPriceInputs[i]) rowData.price = allPriceInputs[i].getAttribute('modelvalue') || allPriceInputs[i].value || '';
        if (allStockInputs[i]) rowData.stock = allStockInputs[i].getAttribute('modelvalue') || allStockInputs[i].value || '';
        if (allSkuTextareas[i]) rowData.sku = allSkuTextareas[i].getAttribute('modelvalue') || allSkuTextareas[i].value || '';
        
        if (rowData.price || rowData.stock) {
          rows.push(rowData);
        }
      }
    }
    
    // 嘗試補充規格名稱資訊（用於參考，非必要）
    const firstVarCells = tableContainer.querySelectorAll('.first-variation-cell');
    const secondVarCells = tableContainer.querySelectorAll('.second-variation-cell');
    
    // 第一規格的 cells 通常有 rowspan，數量會比實際行數少
    // 第二規格的 cells 數量應該等於行數
    let varIdx = 0;
    let currentVar1Name = '';
    for (let i = 0; i < rows.length; i++) {
      // 第二規格名稱
      if (secondVarCells[i]) {
        const c = secondVarCells[i].cloneNode(true);
        c.querySelectorAll('.image-manager-wrapper, .shopee-image-manager').forEach(el => el.remove());
        rows[i].variantName2 = c.textContent?.trim() || '';
      }
    }
    
    // 第一規格名稱 - 根據 rowspan 或 data 屬性分配
    if (firstVarCells.length > 0) {
      for (const cell of firstVarCells) {
        const c = cell.cloneNode(true);
        c.querySelectorAll('.image-manager-wrapper, .shopee-image-manager').forEach(el => el.remove());
        const name = c.textContent?.trim() || '';
        if (name) {
          // 找這個 cell 的 rowspan 或包含的行數
          const rowspan = parseInt(cell.getAttribute('rowspan')) || 0;
          const parentRow = cell.closest('.data-group, tr, [class*="row"]');
          
          // 用 rowspan 分配
          if (rowspan > 0) {
            for (let j = varIdx; j < varIdx + rowspan && j < rows.length; j++) {
              rows[j].variantName = name;
            }
            varIdx += rowspan;
          } else {
            // 沒有 rowspan，就按順序分配
            if (varIdx < rows.length) {
              rows[varIdx].variantName = name;
              varIdx++;
            }
          }
        }
      }
    }

    console.log('[蝦皮助手] 價格表共', rows.length, '行');
    if (rows.length > 0) {
      console.log('[蝦皮助手] 第1行:', JSON.stringify(rows[0]));
      console.log('[蝦皮助手] 最後1行:', JSON.stringify(rows[rows.length - 1]));
    }
    return rows;
  }

  // ================================================================
  //  擷取：物流設定
  // ================================================================
  function captureLogistics() {
    const logistics = [];

    // 每個物流項目在 .logistic-item-container 中
    const items = document.querySelectorAll('.logistic-item-container, .logistics-item');
    const seen = new Set();

    for (const item of items) {
      // 物流名稱
      const nameEl = item.querySelector('.logistics-item-name');
      if (!nameEl) continue;
      const name = nameEl.textContent.trim();
      if (seen.has(name)) continue;
      seen.add(name);

      // 開關狀態
      const switchEl = item.querySelector('.eds-switch');
      const enabled = switchEl ? switchEl.classList.contains('eds-switch--open') : false;

      // 運費
      const priceEl = item.querySelector('.shopee-price');
      const price = priceEl ? priceEl.textContent.replace('NT$', '').trim() : '';

      logistics.push({ name, enabled, price });
    }

    return logistics;
  }

  // ================================================================
  //  擷取：通用欄位（用 label 文字找）
  // ================================================================
  function captureSimpleField(labelText) {
    return getFieldByLabel(labelText);
  }

  function getFieldByLabel(labelText) {
    const labels = document.querySelectorAll('.edit-label, .edit-title, label, [class*="label"], [class*="Label"]');
    for (const label of labels) {
      const text = label.textContent?.trim();
      if (!text || !text.includes(labelText)) continue;
      
      const row = label.closest('.edit-row, [class*="form-item"], [class*="row"]');
      if (row) {
        const input = row.querySelector('input.eds-input__input:not([disabled]), input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled])');
        if (input) return input.getAttribute('modelvalue') || input.value || '';
        
        const textarea = row.querySelector('textarea');
        if (textarea) return textarea.getAttribute('modelvalue') || textarea.value || '';
      }
    }
    return '';
  }

  // ================================================================
  //  填入商品資料
  // ================================================================
  async function fillProductData(data) {
    let filledCount = 0;

    // --- 步驟1：先填分類（最重要，其他欄位依賴分類） ---
    if (data.category) {
      const catResult = await fillCategory(data.category);
      if (catResult) {
        filledCount++;
      }
      
      // 等待分類彈窗完全關閉（可能需要手動點確認）
      console.log('[蝦皮助手] 等待分類彈窗關閉...');
      for (let w = 0; w < 20; w++) { // 最多等 10 秒
        await sleep(500);
        const modalOpen = document.querySelector('.eds-modal__box');
        if (!modalOpen) {
          console.log('[蝦皮助手] 分類彈窗已關閉，繼續填入其他欄位');
          break;
        }
        if (w === 10) {
          console.log('[蝦皮助手] 彈窗仍開啟，請手動點擊「確認」/「Confirm」按鈕...');
        }
      }
      // 分類確認後，頁面要載入新欄位
      await sleep(800);
    }

    // --- 步驟2：填商品名稱 ---
    if (data.name) {
      if (fillProductName(data.name)) {
        filledCount++;
        console.log('[蝦皮助手] ✓ 商品名稱已填入');
      }
    }

    // --- 步驟3：填商品描述 ---
    const descData = data.description;
    const hasDesc = typeof descData === 'string' ? descData : (descData?.html || descData?.text);
    if (hasDesc) {
      if (fillDescription(descData)) {
        filledCount++;
        console.log('[蝦皮助手] ✓ 商品描述已填入');
      }
    }

    // --- 步驟4：填規格 + 價格/庫存/貨號 ---
    console.log('[蝦皮助手] 步驟4: variations=', data.variations?.length || 0, 'pricingTable=', data.pricingTable?.length || 0);
    console.log('[蝦皮助手] 步驟4: variations 內容:', JSON.stringify(data.variations));
    if (data.variations && data.variations.length > 0 && data.pricingTable && data.pricingTable.length > 0) {
      // 有規格的商品：開啟規格 → 填入規格選項 → 填規格表
      console.log('[蝦皮助手] 有規格商品，開始填入規格...');
      try {
        await fillVariationsAndPricing(data.variations, data.pricingTable);
      } catch (err) {
        console.error('[蝦皮助手] ✗ 填入規格時發生錯誤:', err.message, err.stack);
      }
      filledCount++;
    } else {
      // 無規格的商品：直接填價格/庫存
      let price = data.price;
      let stock = data.stock;
      let sku = data.sku;
      
      if (data.pricingTable && data.pricingTable.length > 0 && !price) {
        price = data.pricingTable[0].price;
        stock = data.pricingTable[0].stock;
        sku = data.pricingTable[0].sku;
        console.log('[蝦皮助手] 從 pricingTable 取得價格:', price, '庫存:', stock, '貨號:', sku);
      }
      
      if (price) {
        const priceResult = fillFieldByLabel('價格', price);
        if (priceResult) console.log('[蝦皮助手] ✓ 價格已填入:', price);
        else console.log('[蝦皮助手] ✗ 價格填入失敗');
      }
      if (stock) {
        const stockResult = fillFieldByLabel('商品數量', stock) || fillFieldByLabel('庫存', stock);
        if (stockResult) console.log('[蝦皮助手] ✓ 庫存已填入:', stock);
        else console.log('[蝦皮助手] ✗ 庫存填入失敗');
      }
      if (sku) {
        const skuResult = fillFieldByLabel('商品選項貨號', sku) || fillFieldByLabel('貨號', sku);
        if (skuResult) console.log('[蝦皮助手] ✓ 貨號已填入:', sku);
      }
    }
    if (data.weight) {
      fillFieldByLabel('重量', data.weight);
    }
    if (data.mainSku) {
      fillFieldByLabel('主商品貨號', data.mainSku);
    }

    // --- 步驟5：填入屬性 ---
    if (data.attributes && data.attributes.length > 0) {
      await fillAttributes(data.attributes);
      filledCount++;
      console.log('[蝦皮助手] ✓ 屬性已處理');
    }

    // --- 步驟6：物流開關 ---
    if (data.logistics && data.logistics.length > 0) {
      await fillLogistics(data.logistics);
      filledCount++;
      console.log('[蝦皮助手] ✓ 物流設定已處理');
    }

    if (filledCount === 0) {
      throw new Error('無法找到可填入的欄位，請確認是否在「新增商品」或「編輯商品」頁面');
    }

    return filledCount;
  }

  // ================================================================
  //  填入：商品名稱
  // ================================================================
  function fillProductName(name) {
    const selectors = [
      'input[placeholder*="品牌名稱"]',
      'input[placeholder*="商品名稱"]',
      'input[placeholder*="商品類型"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { setNativeValue(el, name); return true; }
    }
    return fillFieldByLabel('商品名稱', name);
  }

  // ================================================================
  //  填入：商品描述
  // ================================================================
  function fillDescription(descData) {
    // 相容舊版（純字串）和新版（{html, text}）
    let html = '';
    let text = '';
    if (typeof descData === 'string') {
      text = descData;
      html = '';
    } else {
      html = descData?.html || '';
      text = descData?.text || '';
    }

    const editors = document.querySelectorAll('.ql-editor, [contenteditable="true"]');
    for (const editor of editors) {
      if (editor.offsetParent === null) continue;
      const section = editor.closest('[class*="description"], [class*="desc"]') ||
                      findAncestorWithText(editor, '商品描述');
      if (section || editors.length === 1) {
        if (html) {
          // 有 HTML 格式，直接用（保留原始排版）
          editor.innerHTML = html;
        } else {
          // 純文字 fallback — 用 <br> 換行而不是 <p>，避免行距過大
          editor.innerHTML = text.replace(/\n/g, '<br>');
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  // ================================================================
  //  填入：分類（透過搜尋功能）
  // ================================================================
  async function fillCategory(categoryText) {
    // categoryText 格式：「母嬰用品 > 清潔與護膚用品 > 濕紙巾」
    const parts = categoryText.split('>').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return false;
    console.log('[蝦皮助手] fillCategory: 分類路徑 =', parts);

    // ── 步驟1：打開分類彈窗 ──
    const catBox = document.querySelector('.product-category-box-inner');
    if (catBox) {
      catBox.click();
      console.log('[蝦皮助手] 點擊 product-category-box-inner');
    } else {
      // 備用：找其他可能的分類觸發元素
      const catText = document.querySelector('.product-category-text');
      if (catText) { catText.click(); console.log('[蝦皮助手] 點擊 product-category-text'); }
      else {
        console.log('[蝦皮助手] 找不到分類觸發元素');
        return false;
      }
    }
    
    // 等待彈窗出現
    let modal = null;
    for (let w = 0; w < 10; w++) {
      await sleep(500);
      modal = document.querySelector('.eds-modal__box');
      if (modal) {
        console.log('[蝦皮助手] 彈窗已出現');
        break;
      }
    }
    if (!modal) {
      console.log('[蝦皮助手] 等待彈窗超時');
      return false;
    }
    await sleep(500);

    // ── 步驟2：不搜尋，直接逐層瀏覽點擊 ──
    // 注意：Shopee 用 Vue teleport，分類列表的 DOM 可能不在 eds-modal__box 內
    // 因此必須用 document 全域搜尋
    for (let i = 0; i < parts.length; i++) {
      const partName = parts[i];
      console.log('[蝦皮助手] 準備點擊第', i, '層:', partName);
      
      let clicked = false;
      for (let retry = 0; retry < 10; retry++) {
        await sleep(300);
        
        // 用 document 全域搜尋所有 ul.scroll-item
        const allUls = document.querySelectorAll('ul.scroll-item');
        // 也找 .category-list 下的
        const catListUls = document.querySelectorAll('.category-list ul');
        // 全域找 li.category-item
        const allLis = document.querySelectorAll('li.category-item');
        // 全域找 p.text-overflow
        const allPs = document.querySelectorAll('p.text-overflow');
        
        if (retry === 0 || retry === 3) {
          console.log('[蝦皮助手] 第', i, '層 retry', retry, 
            ': scroll-item:', allUls.length,
            ', category-list ul:', catListUls.length,
            ', li.category-item:', allLis.length, 
            ', p.text-overflow:', allPs.length);
        }
        
        // 方法A：用 scroll-item 按層級
        if (allUls.length > i) {
          const ul = allUls[i];
          const lis = ul.querySelectorAll('li');
          for (const li of lis) {
            const p = li.querySelector('p');
            if (p && p.textContent.trim() === partName) {
              li.click();
              clicked = true;
              console.log('[蝦皮助手] ✓ 方法A點擊:', partName);
              break;
            }
          }
        }
        
        // 方法B：遍歷所有 p.text-overflow 做文字比對
        if (!clicked && allPs.length > 0) {
          for (const p of allPs) {
            if (p.textContent.trim() === partName) {
              const li = p.closest('li') || p.parentElement;
              if (li && !li.classList.contains('selected')) {
                li.click();
                clicked = true;
                console.log('[蝦皮助手] ✓ 方法B點擊:', partName);
              } else if (li && li.classList.contains('selected')) {
                // 已經選中了，算成功
                clicked = true;
                console.log('[蝦皮助手] ✓ 已經選中:', partName);
              }
              break;
            }
          }
        }

        if (clicked) break;
      }
      
      if (!clicked) {
        console.log('[蝦皮助手] ✗ 第', i, '層無法找到:', partName);
      }
      
      // 點擊後等待下一層載入
      await sleep(400);
    }

    // ── 步驟3：驗證底部已選擇的分類 ──
    await sleep(500);
    const selectedSpans = document.querySelectorAll('.cat-selected-item');
    const selectedPath = selectedSpans 
      ? Array.from(selectedSpans).map(el => el.textContent.replace(/>/g, '').trim()).filter(Boolean)
      : [];
    console.log('[蝦皮助手] 目前已選擇:', selectedPath.join(' > '));

    // ── 步驟4：點確認按鈕 ──
    // 精確定位「編輯分類」modal 裡的確認按鈕
    
    // 等待一下讓分類選擇完全生效
    await sleep(500);

    let confirmBtn = null;

    // 蝦皮 modal 按鈕現在可能是英文 (Confirm) 或中文 (確認 / 確定)
    const CONFIRM_TEXTS = ['確認', '確定', 'Confirm', 'OK'];
    const CANCEL_TEXTS = ['取消', 'Cancel'];
    const isConfirmText = (s) => {
      const t = (s || '').trim();
      if (!t || CANCEL_TEXTS.includes(t)) return false;
      return CONFIRM_TEXTS.some(x => t === x || t.includes(x));
    };

    // 方法A: 找到標題為「編輯分類」(或英文 Edit Category) 的 modal，從裡面找確認按鈕
    const allModals = document.querySelectorAll('.eds-modal__box');
    for (const modal of allModals) {
      const title = modal.querySelector('.eds-modal__title');
      const titleText = title ? title.textContent.trim() : '';
      const isEditCategoryModal = titleText.includes('編輯分類') ||
                                  titleText.toLowerCase().includes('edit category') ||
                                  titleText.toLowerCase().includes('category');
      if (!isEditCategoryModal) continue;

      console.log('[蝦皮助手] 找到「編輯分類」modal, 標題:', titleText);

      // 優先找 modal footer 的 primary 按鈕（最穩定，不靠文字）
      const primaryBtn = modal.querySelector('.eds-modal__footer-buttons .eds-button--primary, .eds-modal__footer .eds-button--primary');
      if (primaryBtn && !primaryBtn.disabled) {
        confirmBtn = primaryBtn;
        console.log('[蝦皮助手] 在編輯分類 modal footer 找到 primary 按鈕, 文字:', primaryBtn.textContent.trim());
        break;
      }

      // 退而求其次：用文字匹配
      const btns = modal.querySelectorAll('button');
      for (const btn of btns) {
        if (isConfirmText(btn.textContent) && !btn.disabled) {
          confirmBtn = btn;
          console.log('[蝦皮助手] 在編輯分類 modal 用文字匹配找到確認按鈕:', btn.textContent.trim());
          break;
        }
      }
      // 如果還是 disabled 也先抓一個
      if (!confirmBtn) {
        for (const btn of btns) {
          if (isConfirmText(btn.textContent) || (btn.classList.contains('eds-button--primary') && !CANCEL_TEXTS.includes(btn.textContent.trim()))) {
            confirmBtn = btn;
            console.log('[蝦皮助手] 找到確認按鈕 (可能還是 disabled), 文字:', btn.textContent.trim());
            break;
          }
        }
      }
      break;
    }

    // 方法B: fallback - 找所有可見的「確認/Confirm」按鈕
    if (!confirmBtn) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        if (isConfirmText(btn.textContent) && btn.offsetParent !== null && btn.getBoundingClientRect().width > 0) {
          if (!btn.disabled) {
            confirmBtn = btn;
            console.log('[蝦皮助手] fallback: 找到可見且可用的確認按鈕:', btn.textContent.trim());
            break;
          }
        }
      }
    }

    // 方法C: 最後手段 - 找任何可見的確認按鈕（即使 disabled）
    if (!confirmBtn) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        if (isConfirmText(btn.textContent) && btn.offsetParent !== null && btn.getBoundingClientRect().width > 0) {
          confirmBtn = btn;
          console.log('[蝦皮助手] fallback2: 找到可見的確認按鈕 (disabled:', btn.disabled, '), 文字:', btn.textContent.trim());
          break;
        }
      }
    }

    if (confirmBtn) {
      console.log('[蝦皮助手] 找到確認按鈕, class:', confirmBtn.className, 'disabled:', confirmBtn.disabled);
      
      // 等待按鈕變成可點擊狀態（最多等 3 秒）
      for (let w = 0; w < 15; w++) {
        if (!confirmBtn.disabled && !confirmBtn.classList.contains('is-disabled') && !confirmBtn.classList.contains('eds-button--disabled')) {
          break;
        }
        console.log('[蝦皮助手] 按鈕暫時 disabled，等待...');
        await sleep(200);
      }
      
      // 確保按鈕在可視範圍內
      confirmBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
      await sleep(200);

      const rect = confirmBtn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      
      // 方式1：先移除可能的 pointer-events 限制，然後直接 click
      confirmBtn.style.pointerEvents = 'auto';
      confirmBtn.click();
      console.log('[蝦皮助手] 方式1: direct click (pointerEvents forced)');
      await sleep(500);

      let modalStillOpen = document.querySelector('.eds-modal__box');
      if (!modalStillOpen) {
        console.log('[蝦皮助手] ✓ 彈窗已關閉 (direct click 成功)');
        await sleep(800);
        return true;
      }

      // 方式2：點擊按鈕內的 <span> 元素
      const innerSpan = confirmBtn.querySelector('span');
      if (innerSpan) {
        innerSpan.style.pointerEvents = 'auto';
        innerSpan.click();
        console.log('[蝦皮助手] 方式2: span.click()');
        await sleep(500);
      }

      modalStillOpen = document.querySelector('.eds-modal__box');
      if (!modalStillOpen) {
        console.log('[蝦皮助手] ✓ 彈窗已關閉 (span.click 成功)');
        await sleep(800);
        return true;
      }

      // 方式3：完整的 pointer+mouse 事件序列（加 isTrusted workaround）
      const evtInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
      confirmBtn.dispatchEvent(new PointerEvent('pointerdown', evtInit));
      confirmBtn.dispatchEvent(new MouseEvent('mousedown', evtInit));
      await sleep(50);
      confirmBtn.dispatchEvent(new PointerEvent('pointerup', evtInit));
      confirmBtn.dispatchEvent(new MouseEvent('mouseup', evtInit));
      confirmBtn.dispatchEvent(new MouseEvent('click', evtInit));
      console.log('[蝦皮助手] 方式3: pointer+mouse 事件序列');
      await sleep(500);

      modalStillOpen = document.querySelector('.eds-modal__box');
      if (!modalStillOpen) {
        console.log('[蝦皮助手] ✓ 彈窗已關閉 (pointer 成功)');
        await sleep(800);
        return true;
      }

      // 方式4：focus + Enter
      confirmBtn.focus();
      await sleep(100);
      confirmBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      confirmBtn.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
      confirmBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      console.log('[蝦皮助手] 方式4: focus + Enter');
      await sleep(500);

      modalStillOpen = document.querySelector('.eds-modal__box');
      if (!modalStillOpen) {
        console.log('[蝦皮助手] ✓ 彈窗已關閉 (Enter 成功)');
        await sleep(800);
        return true;
      }

      // 方式5：用 elementFromPoint 避免覆蓋層問題
      const topEl = document.elementFromPoint(x, y);
      if (topEl) {
        console.log('[蝦皮助手] 方式5: elementFromPoint 找到:', topEl.tagName, topEl.className);
        topEl.click();
        await sleep(500);
      }

      modalStillOpen = document.querySelector('.eds-modal__box');
      if (!modalStillOpen) {
        console.log('[蝦皮助手] ✓ 彈窗已關閉 (elementFromPoint 成功)');
        await sleep(800);
        return true;
      }

      // 方式6：嘗試 Vue 內部事件（__vue__ 或 __vueParentComponent）
      try {
        const vueEl = confirmBtn.__vue__ || confirmBtn.__vueParentComponent;
        if (vueEl && vueEl.$emit) {
          vueEl.$emit('click');
          console.log('[蝦皮助手] 方式6: Vue $emit click');
          await sleep(500);
        }
      } catch (e) {}

      modalStillOpen = document.querySelector('.eds-modal__box');
      if (!modalStillOpen) {
        console.log('[蝦皮助手] ✓ 彈窗已關閉 (Vue 成功)');
        await sleep(800);
        return true;
      }

      // 方式7：移除 modal 上的 overlay 後再點
      try {
        const overlays = document.querySelectorAll('.eds-modal__mask, .eds-modal__wrapper, [class*="overlay"], [class*="mask"]');
        for (const ov of overlays) {
          ov.style.pointerEvents = 'none';
        }
        confirmBtn.click();
        console.log('[蝦皮助手] 方式7: 移除 overlay 後 click');
        await sleep(500);
        // 恢復
        for (const ov of overlays) {
          ov.style.pointerEvents = '';
        }
      } catch (e) {}

      modalStillOpen = document.querySelector('.eds-modal__box');
      if (!modalStillOpen) {
        console.log('[蝦皮助手] ✓ 彈窗已關閉 (overlay removed 成功)');
        await sleep(800);
        return true;
      }

      console.log('[蝦皮助手] ✗ 所有自動點擊方式都失敗，請手動點擊「確認」按鈕');
      return true;
    }
    
    console.log('[蝦皮助手] ✗ 找不到確認按鈕，請手動點擊');
    return true;
  }

  // ================================================================
  //  填入：規格 + 規格價格表
  // ================================================================
  async function fillVariationsAndPricing(variations, pricingTable) {
    console.log('[蝦皮助手] 規格數:', variations.length, '價格表行數:', pricingTable.length);
    
    // 步驟1：點擊「開啟商品規格」(蝦皮可能改成英文 Enable Variations / Add Variation)
    // 容器先用 class 偵測；找不到再用文字匹配
    const SPEC_OPEN_TEXTS = ['開啟商品規格', '新增規格', '啟用商品規格',
                              'Enable Variations', 'Add Variation', 'Add Variations',
                              'Enable Variation', 'Variations'];
    let specOpened = false;

    // 先檢查規格區塊是否已經展開（避免重複點擊把它關掉）
    const existingSpec = document.querySelector('[class*="variation-edit"], [class*="tier-variation"], [class*="variations-form"], [class*="sku-edit"]');
    if (existingSpec) {
      console.log('[蝦皮助手] 規格區塊已經開啟，跳過按鈕點擊');
      specOpened = true;
    }

    if (!specOpened) {
      const allBtns = document.querySelectorAll('button, .eds-button');
      for (const btn of allBtns) {
        const txt = (btn.textContent || '').trim();
        if (!txt) continue;
        const matched = SPEC_OPEN_TEXTS.some(t => txt === t || txt.includes(t));
        if (!matched) continue;
        // 排除 Cancel 之類
        if (txt === '取消' || txt === 'Cancel') continue;
        // 必須可見
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        btn.click();
        specOpened = true;
        console.log('[蝦皮助手] ✓ 點擊「開啟商品規格」按鈕, 文字:', txt);
        break;
      }
    }

    if (!specOpened) {
      console.log('[蝦皮助手] ✗ 找不到「開啟商品規格」按鈕（已嘗試中英文）');
      // 列出頁面上所有含「規格 / Variation」的按鈕，方便排查
      const debugBtns = Array.from(document.querySelectorAll('button, .eds-button'))
        .map(b => (b.textContent || '').trim())
        .filter(t => t && (t.includes('規格') || /variation/i.test(t)))
        .slice(0, 10);
      console.log('[蝦皮助手] 頁面上含規格/Variation 文字的按鈕:', debugBtns);
      return;
    }
    
    await sleep(500);
    
    // 步驟2：填入每組規格
    // 策略：不緩存 DOM 引用，每次操作前都重新定位元素
    // 因為蝦皮的 Vue 框架會在填入名稱後重新渲染 DOM
    
    // 工具函式：找到第 N 組規格的獨立容器（每次呼叫都重新掃描 DOM）
    function findSpecContainer(specIndex) {
      // 用 TreeWalker 找「商品規格N」文字
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const allLabels = [];
      
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim();
        const match = text.match(/^商品規格\s*(\d+)$/);
        if (match) {
          allLabels.push({ element: walker.currentNode.parentElement, index: parseInt(match[1]) });
        }
      }
      
      const targetLabel = allLabels.find(l => l.index === specIndex);
      if (!targetLabel) {
        console.log('[蝦皮助手] findSpecContainer: 找不到「商品規格' + specIndex + '」標籤');
        return null;
      }
      
      // 從標籤往上找容器，排除包含其他規格標籤的容器
      // 關鍵：容器至少要有2個 input（1個規格名稱 + 1個選項輸入框）
      // 如果只有1個 input，表示只找到名稱框，選項框在更外層
      let el = targetLabel.element;
      let candidateContainers = []; // 收集所有候選容器
      
      for (let up = 0; up < 15; up++) {
        el = el?.parentElement;
        if (!el) break;
        
        const inputs = el.querySelectorAll('input.eds-input__input');
        if (inputs.length < 1) continue;
        if (inputs.length >= 30) continue; // 太大了，整個頁面
        
        // 確認容器內沒有「其他規格」的標籤
        let hasOtherSpec = false;
        for (const otherLabel of allLabels) {
          if (otherLabel.index !== specIndex && el.contains(otherLabel.element)) {
            hasOtherSpec = true;
            break;
          }
        }
        
        if (!hasOtherSpec) {
          candidateContainers.push({ element: el, inputCount: inputs.length, level: up });
          console.log('[蝦皮助手] findSpecContainer(' + specIndex + '): 候選容器 level=' + up + ' inputs=' + inputs.length + ' tag=' + el.tagName + '.' + (el.className || '').toString().substring(0, 50));
          
          // 如果有2個以上 input，找到了！
          if (inputs.length >= 2) {
            console.log('[蝦皮助手] findSpecContainer(' + specIndex + '): 使用容器 inputs=' + inputs.length);
            return el;
          }
          // 如果只有1個，繼續往上找更大的容器
        }
      }
      
      // 如果沒找到 >= 2 input 的容器，用最大的候選容器
      if (candidateContainers.length > 0) {
        const best = candidateContainers[candidateContainers.length - 1];
        console.log('[蝦皮助手] findSpecContainer(' + specIndex + '): 沒有>=2 input的容器，用最大候選: inputs=' + best.inputCount);
        return best.element;
      }
      
      console.log('[蝦皮助手] findSpecContainer(' + specIndex + '): 找不到獨立容器');
      return null;
    }
    
    // 工具函式：在容器內找到規格名稱 input
    function findSpecNameInput(container) {
      const inputs = container.querySelectorAll('input.eds-input__input');
      // 優先找 maxlength=14
      for (const input of inputs) {
        if (input.getAttribute('maxlength') === '14') return input;
      }
      // 備用：找 placeholder 包含 /14
      for (const input of inputs) {
        const ph = input.getAttribute('placeholder') || '';
        if (ph.includes('/14')) return input;
      }
      // 最後備用：容器內第一個 input（排除 maxlength=20 的選項 input）
      for (const input of inputs) {
        if (input.getAttribute('maxlength') !== '20') return input;
      }
      return inputs[0] || null;
    }
    
    // 工具函式：在容器內找到空的選項 input
    function findEmptyOptionInput(container) {
      // 優先找 maxlength=20 的空 input
      const inputs20 = container.querySelectorAll('input.eds-input__input[maxlength="20"]');
      for (const input of inputs20) {
        if (!input.value) return input;
      }
      // 備用：找 placeholder 包含「輸入」的空 input（排除規格名稱）
      const allInputs = container.querySelectorAll('input.eds-input__input');
      for (const input of allInputs) {
        const ph = input.getAttribute('placeholder') || '';
        const ml = input.getAttribute('maxlength');
        if (!input.value && ml !== '14' && (ph.includes('輸入') || ml === '20')) return input;
      }
      return null;
    }
    
    // 工具函式：填入選項並按 Enter 確認
    async function typeOptionAndConfirm(input, text, specIndex, optIndex) {
      // Focus + click
      input.scrollIntoView({ block: 'center' });
      await sleep(100);
      input.focus();
      input.click();
      await sleep(150);
      
      // 清空
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(50);
      
      // 方法1: execCommand insertText（最能觸發 Vue）
      document.execCommand('insertText', false, text);
      await sleep(200);
      
      // 驗證是否生效
      if (input.value !== text) {
        // 方法2: nativeInputValueSetter
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[蝦皮助手] 規格' + specIndex + ' 選項' + optIndex + ' execCommand 無效，用 setter');
        await sleep(300);
      }
      
      console.log('[蝦皮助手] 規格' + specIndex + ' 選項' + optIndex + ' 值=' + input.value);
      
      // 按 Enter 確認 - 多種方式並行
      // 方式A: 完整鍵盤事件序列
      const enterOpts = { key: 'Enter', keyCode: 13, code: 'Enter', which: 13, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
      await sleep(50);
      input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
      await sleep(50);
      input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
      await sleep(300);
      
      // 方式B: blur
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(200);
      
      // 方式C: 找容器內的加號/確認按鈕（重新定位容器，因為 DOM 可能已變）
      const freshContainer = findSpecContainer(specIndex);
      if (freshContainer) {
        // 找 + 按鈕或加號圖標
        const addBtns = freshContainer.querySelectorAll('[class*="add-option"], [class*="add-btn"]');
        for (const btn of addBtns) {
          btn.click();
          console.log('[蝦皮助手] 點擊 add 按鈕');
          await sleep(200);
          break;
        }
        
        // 找有 + 號的 icon 或 svg
        const allClickable = freshContainer.querySelectorAll('i, svg, span, button');
        for (const el of allClickable) {
          const cls = (el.className || '').toString();
          const text = el.textContent?.trim();
          if (cls.includes('add') || cls.includes('plus') || text === '+') {
            // 排除已知的按鈕（如刪除、拖動等）
            if (!cls.includes('delete') && !cls.includes('remove') && !cls.includes('drag')) {
              el.click();
              console.log('[蝦皮助手] 點擊 icon:', cls.substring(0, 30) || text);
              await sleep(200);
              break;
            }
          }
        }
      }
      
      await sleep(300);
    }
    
    // === 主流程：逐組填入規格 ===
    for (let vi = 0; vi < variations.length; vi++) {
      const variation = variations[vi];
      const specNum = vi + 1;
      console.log('[蝦皮助手] === 開始填入規格', specNum, ':', variation.name, '選項:', JSON.stringify(variation.options), '===');
      
      // 如果是第2組規格，需要點「新增規格 2」
      if (vi > 0) {
        const allBtnsForAdd = document.querySelectorAll('button');
        for (const btn of allBtnsForAdd) {
          if (btn.textContent.trim().includes('新增規格')) {
            btn.click();
            console.log('[蝦皮助手] 點擊「新增規格」');
            await sleep(600);
            break;
          }
        }
      }
      
      await sleep(500);
      
      // 1) 填入規格名稱（每次重新定位容器）
      let container = findSpecContainer(specNum);
      if (!container) {
        console.log('[蝦皮助手] ✗ 找不到規格', specNum, '容器，跳過');
        continue;
      }
      
      const nameInput = findSpecNameInput(container);
      if (nameInput) {
        nameInput.scrollIntoView({ block: 'center' });
        await sleep(100);
        setNativeValue(nameInput, variation.name);
        console.log('[蝦皮助手] ✓ 規格', specNum, '名稱:', variation.name);
        await sleep(800); // 等久一點讓 Vue 重新渲染
      } else {
        console.log('[蝦皮助手] ✗ 規格', specNum, '找不到名稱 input');
      }
      
      // 2) 逐一填入選項（每次都重新定位容器和空 input）
      for (let oi = 0; oi < variation.options.length; oi++) {
        const optionText = variation.options[oi];
        
        // 重新定位容器（DOM 可能已因前一次操作而重新渲染）
        container = findSpecContainer(specNum);
        if (!container) {
          console.log('[蝦皮助手] ✗ 規格', specNum, '選項', oi + 1, '容器丟失');
          break;
        }
        
        const optInput = findEmptyOptionInput(container);
        if (!optInput) {
          console.log('[蝦皮助手] ✗ 規格', specNum, '選項', oi + 1, '找不到空 input');
          // Debug: 列出容器內所有 input
          const debugInputs = container.querySelectorAll('input.eds-input__input');
          console.log('[蝦皮助手] DEBUG 容器 inputs:', Array.from(debugInputs).map(inp => ({
            ml: inp.getAttribute('maxlength'),
            ph: (inp.getAttribute('placeholder') || '').substring(0, 20),
            val: (inp.value || '').substring(0, 20),
            visible: inp.offsetParent !== null
          })));
          break;
        }
        
        await typeOptionAndConfirm(optInput, optionText, specNum, oi + 1);
        console.log('[蝦皮助手] ✓ 規格', specNum, '選項', oi + 1, '/', variation.options.length, ':', optionText);
        
        await sleep(400); // 等 DOM 更新
      }
      
      console.log('[蝦皮助手] === 規格', specNum, '填入完成 ===');
      await sleep(500);
    }
    
    // 步驟3：等待規格表出現
    console.log('[蝦皮助手] 等待規格表出現...');
    let tableFound = false;
    for (let w = 0; w < 10; w++) {
      await sleep(500);
      const table = document.querySelector('.variation-model-table, [class*="pricing-table"], [class*="spec-table"]');
      if (table) {
        tableFound = true;
        console.log('[蝦皮助手] ✓ 規格表已出現');
        break;
      }
      // 也找簡單的多行價格/庫存區域
      const priceInputs = document.querySelectorAll('.basic-price input.eds-input__input');
      if (priceInputs.length > 0) {
        tableFound = true;
        console.log('[蝦皮助手] ✓ 找到價格輸入框（', priceInputs.length, '個）');
        break;
      }
    }
    
    if (!tableFound) {
      console.log('[蝦皮助手] ✗ 規格表未出現，嘗試直接填入');
    }
    
    await sleep(500);
    
    // 步驟3.5：展開規格表（點擊「查看全部」）
    let fillExpanded = false;
    const expandWalker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (expandWalker2.nextNode()) {
      const text = expandWalker2.currentNode.textContent.trim();
      if (text.match(/查看全部/) && text.match(/\d+個?\)/)) {
        let clickTarget = expandWalker2.currentNode.parentElement;
        for (let up = 0; up < 3 && clickTarget; up++) {
          const tag = clickTarget.tagName?.toLowerCase();
          if (tag === 'a' || tag === 'button' || clickTarget.onclick || clickTarget.style?.cursor === 'pointer') break;
          clickTarget = clickTarget.parentElement;
        }
        if (clickTarget) {
          clickTarget.click();
          fillExpanded = true;
          console.log('[蝦皮助手] 填入前展開規格表:', text);
          await sleep(1000);
          break;
        }
      }
    }
    if (!fillExpanded) {
      // 備用：找所有 <a> 包含「查看全部」
      const allLinks = document.querySelectorAll('a');
      for (const link of allLinks) {
        if ((link.textContent?.trim() || '').includes('查看全部')) {
          link.click();
          console.log('[蝦皮助手] 備用展開規格表:', link.textContent?.trim());
          await sleep(1000);
          break;
        }
      }
    }
    
    // 步驟4：填入規格表的價格/庫存/貨號
    // 找所有價格 input
    const priceInputs = document.querySelectorAll('.basic-price input.eds-input__input, .price-column input.eds-input__input');
    const stockInputs = document.querySelectorAll('.two-tier-basic-stock input.eds-input__input, .stock-column input.eds-input__input');
    const skuTextareas = document.querySelectorAll('.sku-textarea textarea, .sku-column textarea');
    
    console.log('[蝦皮助手] 規格表: 價格框', priceInputs.length, '庫存框', stockInputs.length, '貨號框', skuTextareas.length);
    
    for (let i = 0; i < pricingTable.length; i++) {
      const row = pricingTable[i];
      
      if (priceInputs[i] && row.price) {
        setNativeValue(priceInputs[i], row.price);
        console.log('[蝦皮助手] ✓ 規格', i + 1, '價格:', row.price);
      }
      if (stockInputs[i] && row.stock) {
        setNativeValue(stockInputs[i], row.stock);
        console.log('[蝦皮助手] ✓ 規格', i + 1, '庫存:', row.stock);
      }
      if (skuTextareas[i] && row.sku) {
        setNativeValue(skuTextareas[i], row.sku);
        console.log('[蝦皮助手] ✓ 規格', i + 1, '貨號:', row.sku);
      }
    }
    
    // 如果上面沒找到，嘗試用 data-group 方式
    if (priceInputs.length === 0) {
      const dataGroups = document.querySelectorAll('.variation-model-table-body .data-group');
      console.log('[蝦皮助手] 嘗試 data-group 方式，找到', dataGroups.length, '個');
      
      dataGroups.forEach((group, idx) => {
        if (idx >= pricingTable.length) return;
        const row = pricingTable[idx];
        
        const pInput = group.querySelector('.basic-price input.eds-input__input, input.eds-input__input');
        const sInput = group.querySelector('.two-tier-basic-stock input.eds-input__input');
        const skuTa = group.querySelector('.sku-textarea textarea');
        
        if (pInput && row.price) setNativeValue(pInput, row.price);
        if (sInput && row.stock) setNativeValue(sInput, row.stock);
        if (skuTa && row.sku) setNativeValue(skuTa, row.sku);
      });
    }
    
    console.log('[蝦皮助手] ✓ 規格表填入完成');
    
    // 步驟5：重新觸發所有價格/庫存欄位的驗證（消除紅色警告）
    await sleep(500);
    const allFilledInputs = document.querySelectorAll('.variation-model-table input.eds-input__input, .variation-model-table textarea');
    console.log('[蝦皮助手] 重新驗證', allFilledInputs.length, '個欄位');
    for (const inp of allFilledInputs) {
      if (inp.value) {
        inp.focus();
        inp.dispatchEvent(new Event('focus', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(50);
        inp.blur();
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }
  }

  // ================================================================
  //  填入：屬性欄位
  // ================================================================
  async function fillAttributes(attributesData) {
    console.log('[蝦皮助手] 開始填入屬性，共', attributesData.length, '個');
    
    // 找到頁面上所有屬性項目
    const items = document.querySelectorAll('.attribute-select-item');
    console.log('[蝦皮助手] 頁面上找到', items.length, '個屬性欄位');
    
    for (const attrData of attributesData) {
      try {
        console.log('[蝦皮助手] 嘗試填入屬性:', attrData.name, '=', attrData.value || attrData.values);
        
        // 找到對應名稱的屬性欄位
        let targetItem = null;
        for (const item of items) {
          const titleEl = item.querySelector('.item-title-text');
          const labelEl = item.querySelector('.edit-label');
          const itemName = titleEl?.textContent?.trim() || labelEl?.textContent?.replace('*', '')?.trim();
          
          if (itemName && itemName.includes(attrData.name)) {
            targetItem = item;
            break;
          }
        }
        
        if (!targetItem) {
          console.log('[蝦皮助手] ✗ 找不到屬性欄位:', attrData.name);
          continue;
        }
        
        // 根據類型填入
        if (attrData.type === 'text-input') {
          const input = targetItem.querySelector('input.eds-input__input');
          if (input) {
            setNativeValue(input, attrData.value);
            console.log('[蝦皮助手] ✓ 文字屬性:', attrData.name, '=', attrData.value);
          }
          
          // 處理單位選擇器（如 CM, ML, KG 等）
          if (attrData.unit) {
            const unitSelector = targetItem.querySelector('.listing-unit-input-unit .eds-selector');
            if (unitSelector) {
              console.log('[蝦皮助手] 嘗試填入單位:', attrData.unit);
              unitSelector.click();
              await sleep(400);
              
              // 在下拉選單中找到對應的單位選項（.eds-option）
              const options = document.querySelectorAll('.eds-option, .eds-select__options .eds-option, .eds-selector-dropdown__item, .eds-select-dropdown__item');
              let unitSet = false;
              for (const opt of options) {
                if (opt.offsetParent === null) continue;
                const optText = opt.textContent.trim();
                if (optText === attrData.unit) {
                  opt.click();
                  unitSet = true;
                  console.log('[蝦皮助手] ✓ 單位已選擇:', attrData.unit);
                  await sleep(200);
                  break;
                }
              }
              if (!unitSet) {
                console.log('[蝦皮助手] ✗ 找不到單位選項:', attrData.unit);
                await closeAllDropdowns();
              }
            }
          }
        } 
        else if (attrData.type === 'single-select') {
          await fillSelectAttribute(targetItem, attrData.name, attrData.value);
        }
        else if (attrData.type === 'multi-select') {
          for (const val of attrData.values) {
            await fillSelectAttribute(targetItem, attrData.name, val);
          }
          // 多選完成後關閉下拉
          await closeAllDropdowns();
        }
        
        await sleep(200);
      } catch (err) {
        console.warn('[蝦皮助手] 填入屬性時出錯:', attrData.name, err.message);
        // 出錯時嘗試關閉所有下拉，避免卡住
        await closeAllDropdowns();
      }
    }
    
    // 全部完成後再關一次下拉，確保不會有殘留
    await closeAllDropdowns();
  }

  // 關閉所有下拉選單
  async function closeAllDropdowns() {
    // 按 Escape 鍵
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(100);
    // 點擊頁面空白處
    const pageTitle = document.querySelector('.product-edit-title, .basic-info-title, h2, h3');
    if (pageTitle) {
      pageTitle.click();
    } else {
      document.body.click();
    }
    await sleep(200);
  }

  // 填入下拉選單屬性（單選或多選的每一個值）
  async function fillSelectAttribute(item, attrName, value) {
    // 點擊 selector 打開下拉選單
    const selector = item.querySelector('.eds-selector');
    if (!selector) {
      console.log('[蝦皮助手] ✗ 找不到 selector:', attrName);
      return;
    }
    
    selector.click();
    await sleep(250);
    
    // 等待下拉選單出現
    // 選項可能在 item 內部，也可能在 body 的 popper 中
    let optionClicked = false;
    
    for (let retry = 0; retry < 5; retry++) {
      await sleep(200);
      
      // 方法1：在 item 內部找選項
      const options1 = item.querySelectorAll('.eds-option, .eds-dropdown-menu li');
      for (const opt of options1) {
        if (opt.textContent.trim() === value) {
          opt.click();
          optionClicked = true;
          console.log('[蝦皮助手] ✓ 下拉選中(內部):', attrName, '=', value);
          break;
        }
      }
      if (optionClicked) break;
      
      // 方法2：全域找所有可見的下拉選項
      const allPoppers = document.querySelectorAll('.eds-popper:not([style*="display: none"]), .eds-select-popover-content:not([style*="display: none"])');
      for (const popper of allPoppers) {
        const options2 = popper.querySelectorAll('.eds-option, .eds-dropdown-menu li, .eds-checkbox');
        for (const opt of options2) {
          if (opt.textContent.trim() === value || opt.textContent.trim().includes(value)) {
            opt.click();
            optionClicked = true;
            console.log('[蝦皮助手] ✓ 下拉選中(全域):', attrName, '=', value);
            break;
          }
        }
        if (optionClicked) break;
      }
      if (optionClicked) break;
      
      // 方法3：搜尋框輸入（有些下拉有搜尋功能）
      if (retry === 2) {
        const searchInput = item.querySelector('.eds-select-popover-content input, .eds-dropdown input');
        if (searchInput) {
          setNativeValue(searchInput, value);
          await sleep(250);
        }
      }
    }
    
    if (!optionClicked) {
      console.log('[蝦皮助手] ✗ 下拉找不到選項:', attrName, '=', value);
      // 點擊其他地方關閉下拉
      document.body.click();
    }
    
    await sleep(150);
  }

  // ================================================================
  //  填入：物流開關
  // ================================================================
  async function fillLogistics(logisticsData) {
    // 建立名稱到狀態的映射
    const targetState = {};
    logisticsData.forEach(l => { targetState[l.name] = l.enabled; });

    // 遍歷頁面上的物流項目
    const items = document.querySelectorAll('.logistic-item-container');
    const processed = new Set();

    for (const item of items) {
      const nameEl = item.querySelector('.logistics-item-name');
      if (!nameEl) continue;
      const name = nameEl.textContent.trim();
      if (processed.has(name)) continue;
      processed.add(name);

      if (!(name in targetState)) continue;

      const switchEl = item.querySelector('.eds-switch');
      if (!switchEl) continue;

      const currentlyOpen = switchEl.classList.contains('eds-switch--open');
      const shouldBeOpen = targetState[name];

      // 只有狀態不同時才點擊
      if (currentlyOpen !== shouldBeOpen) {
        switchEl.click();
        await sleep(300);

        // 檢查是否彈出確認對話框（運費選項變更確認）
        await dismissLogisticsConfirmDialog();
      }
    }

    // 最後再檢查一次是否有遺留的對話框
    await dismissLogisticsConfirmDialog();
  }

  // 自動點擊物流確認對話框的「確認」按鈕
  async function dismissLogisticsConfirmDialog() {
    for (let i = 0; i < 8; i++) {
      await sleep(300);
      // 找所有 modal
      const modals = document.querySelectorAll('.eds-modal__box, .shopee-modal, [class*="modal"], [class*="dialog"]');
      for (const modal of modals) {
        // 必須可見（rect 有面積）
        const rect = modal.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        
        const text = modal.textContent || '';
        // 排除分類彈窗
        if (text.includes('編輯分類') || text.includes('商品分類')) continue;
        
        // 只處理物流/運費相關的彈窗
        const isLogisticsModal = text.includes('運費') || text.includes('物流') || 
                                  text.includes('宅配') || text.includes('超商') ||
                                  text.includes('店到店') || text.includes('開啟此物流');
        if (!isLogisticsModal) continue;

        // 策略1: 找可見的 primary/danger 按鈕
        const primaryBtns = modal.querySelectorAll('.eds-button--primary, .eds-button--danger');
        for (const btn of primaryBtns) {
          const btnRect = btn.getBoundingClientRect();
          if (btnRect.width === 0) continue;
          const btnText = btn.textContent.trim();
          if (btnText === '取消' || btnText === 'Cancel') continue;
          if (btnText) {
            console.log('[蝦皮助手] 自動點擊物流確認按鈕(primary):', btnText);
            btn.click();
            await sleep(500);
            return true;
          }
        }

        // 策略2: 用文字匹配
        const allBtns = modal.querySelectorAll('button, .eds-button');
        for (const btn of allBtns) {
          const btnRect = btn.getBoundingClientRect();
          if (btnRect.width === 0) continue;
          const btnText = btn.textContent.trim();
          if (btnText === '取消' || btnText === 'Cancel' || !btnText) continue;
          if (btnText.includes('確認') || btnText.includes('確定') || 
              btnText.includes('開啟') || btnText.includes('Confirm') ||
              btnText.includes('送出')) {
            console.log('[蝦皮助手] 自動點擊物流確認按鈕(text):', btnText);
            btn.click();
            await sleep(500);
            return true;
          }
        }
      }
    }
    return false;
  }

  // ================================================================
  //  填入：通用欄位
  // ================================================================
  function fillFieldByLabel(labelText, value) {
    console.log('[蝦皮助手] fillFieldByLabel: 尋找', labelText, '填入', value);
    
    // 方法1：用各種 label/title class 找
    const labelSelectors = [
      '.edit-label', '.edit-title', 'label', 
      '[class*="label"]', '[class*="Label"]', '[class*="title"]',
      '.eds-form-item__label', '.form-label',
      'h3', 'h4', 'strong', '.section-title'
    ];
    
    for (const sel of labelSelectors) {
      const labels = document.querySelectorAll(sel);
      for (const label of labels) {
        const text = label.textContent?.trim();
        if (!text || !text.includes(labelText)) continue;
        
        // 往上找父容器
        const containers = [
          label.closest('.edit-row'),
          label.closest('[class*="form-item"]'),
          label.closest('[class*="row"]'),
          label.closest('[class*="field"]'),
          label.closest('[class*="content"]'),
          label.parentElement,
          label.parentElement?.parentElement
        ].filter(Boolean);
        
        for (const row of containers) {
          const input = row.querySelector('input.eds-input__input:not([disabled])');
          if (input && input.offsetParent !== null) {
            setNativeValue(input, value);
            console.log('[蝦皮助手] 方法1成功:', labelText, '← sel:', sel);
            return true;
          }
          const textarea = row.querySelector('textarea:not([disabled])');
          if (textarea && textarea.offsetParent !== null) {
            setNativeValue(textarea, value);
            return true;
          }
        }
      }
    }

    // 方法2：遍歷所有可見文字元素，找包含 labelText 的
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      // 只看直接文字內容（不含子元素文字）
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');
      
      if (!directText.includes(labelText)) continue;
      if (el.offsetParent === null) continue; // 跳過隱藏的
      
      // 找到了標籤，往上找容器中的 input
      let container = el.parentElement;
      for (let depth = 0; depth < 5 && container; depth++) {
        const input = container.querySelector('input.eds-input__input:not([disabled])');
        if (input && input.offsetParent !== null) {
          setNativeValue(input, value);
          console.log('[蝦皮助手] 方法2成功:', labelText, '← depth:', depth);
          return true;
        }
        container = container.parentElement;
      }
    }

    // 方法3：找該 labelText 旁邊最近的 input（用 DOM 順序）
    const body = document.body.innerHTML;
    const labelIdx = body.indexOf(labelText);
    if (labelIdx > -1) {
      // 從 label 位置開始，找後面最近的 eds-input
      const allInputs = document.querySelectorAll('input.eds-input__input:not([disabled])');
      const allTextElements = document.querySelectorAll('*');
      
      // 找到包含 labelText 的元素
      let labelEl = null;
      for (const el of allTextElements) {
        if (el.children.length < 3 && el.textContent?.trim().includes(labelText) && el.offsetParent !== null) {
          labelEl = el;
          break;
        }
      }
      
      if (labelEl) {
        // 取 label 的位置
        const labelRect = labelEl.getBoundingClientRect();
        let bestInput = null;
        let bestDist = Infinity;
        
        for (const input of allInputs) {
          if (input.offsetParent === null) continue;
          const inputRect = input.getBoundingClientRect();
          // 找在 label 下方或右邊，最近的 input
          const dy = inputRect.top - labelRect.top;
          const dx = inputRect.left - labelRect.left;
          if (dy >= -20 && dy < 200 && Math.abs(dx) < 500) {
            const dist = Math.abs(dy) + Math.abs(dx) * 0.5;
            if (dist < bestDist) {
              bestDist = dist;
              bestInput = input;
            }
          }
        }
        
        if (bestInput) {
          setNativeValue(bestInput, value);
          console.log('[蝦皮助手] 方法3成功:', labelText, '← 距離:', bestDist);
          return true;
        }
      }
    }

    console.log('[蝦皮助手] fillFieldByLabel 失敗:', labelText);
    return false;
  }

  // ================================================================
  //  工具函式
  // ================================================================

  // 模擬原生輸入（讓 Vue/React 偵測到變化）
  function setNativeValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    
    // 先真正 focus 元素（觸發 Vue 的 @focus）
    element.focus();
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    
    // 設值
    if (nativeSetter) { nativeSetter.call(element, value); }
    else { element.value = value; }

    // 觸發 input/change 事件（Vue v-model 監聽）
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    
    // 真正 blur（觸發 Vue 的表單驗證 @blur）
    element.blur();
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // 向上找包含特定文字的祖先元素
  function findAncestorWithText(element, text, maxDepth = 5) {
    let el = element.parentElement;
    let depth = 0;
    while (el && depth < maxDepth) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE || ['LABEL', 'H2', 'H3', 'SPAN'].includes(n.tagName))
        .map(n => n.textContent).join('');
      if (directText.includes(text)) return el;
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

})();
