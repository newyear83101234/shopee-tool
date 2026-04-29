// ===== 蝦皮快速上架助手 v4.1 - Popup 主程式 =====
// 優先使用 Native Host（跨 Profile 共享），失敗時 fallback 到 chrome.storage.local

const ACCOUNT_COLORS = ['#FF6B35', '#00A67E', '#4A90D9', '#9B59B6', '#E74C3C'];
const ACCOUNT_LETTERS = ['A', 'B', 'C', 'D', 'E'];
let nativeConnected = false;

// ========== Native Messaging 工具 ==========
function sendNative(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: 'native', payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || '本機橋接回應錯誤'));
      }
    });
  });
}

// ========== 共用存取（Native 優先，fallback local） ==========
async function sharedSave(nativeAction, localKey, data) {
  // 一定存到 local（本 Profile 備份）
  await new Promise(r => chrome.storage.local.set({ [localKey]: data }, r));
  // 嘗試存到 Native（跨 Profile 共享）
  if (nativeConnected) {
    try { await sendNative({ action: nativeAction, data }); } catch (e) {}
  }
}

async function sharedLoad(nativeAction, localKey) {
  // 優先從 Native 讀
  if (nativeConnected) {
    try {
      const res = await sendNative({ action: nativeAction });
      if (res.data) {
        // 同步到 local
        await new Promise(r => chrome.storage.local.set({ [localKey]: res.data }, r));
        return res.data;
      }
    } catch (e) {}
  }
  // Fallback: 從 local 讀
  const local = await new Promise(r => chrome.storage.local.get([localKey], r));
  return local[localKey] || null;
}

// 傳訊息到 content script
function sendToContent(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: 'content', payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
  showVersion();
  initTabs();
  initSettings();
  initCapture();
  initAI();
  initFill();
  initTitles();
  initDataView();
  await checkNativeConnection();
  await loadSharedData();
});

// 把 manifest 版本顯示在 header（讓使用者一眼確認跑的是哪版）
function showVersion() {
  try {
    const v = chrome.runtime.getManifest().version;
    const el = document.getElementById('version-badge');
    if (el) {
      el.textContent = 'v' + v;
      el.title = '擴充功能版本：v' + v;
    }
  } catch (e) {}
}

// ========== 檢查 Native Host 連線 ==========
async function checkNativeConnection() {
  const errBanner = document.getElementById('native-error');
  try {
    await sendNative({ action: 'ping' });
    nativeConnected = true;
    if (errBanner) errBanner.classList.add('hidden');
  } catch (err) {
    nativeConnected = false;
    if (errBanner) errBanner.classList.remove('hidden');
    console.warn('Native host not connected:', err.message);
  }
}

// ========== 載入資料 ==========
async function loadSharedData() {
  // 載入帳號名稱
  const settings = await sharedLoad('load_settings', 'settings');
  if (settings?.account_names) updateAccountLabels(settings.account_names);

  // 載入商品資料
  const product = await sharedLoad('load_product', 'captured_product');
  if (product && product.name) {
    updateDataView(product);
    document.getElementById('title-0').value = product.name || '';
    const statusEl = document.getElementById('capture-status');
    statusEl.className = 'status-msg success';
    statusEl.textContent = `✅ 已有擷取資料：${product.name || '(空)'}`;
    statusEl.classList.remove('hidden');
  }

  // 載入標題
  const titles = await sharedLoad('load_titles', 'generated_titles');
  if (titles && titles.length > 0) {
    displayTitles(titles);
  }
}

// ========== 頁籤切換 ==========
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ========== 設定 ==========
function initSettings() {
  const modal = document.getElementById('settings-modal');

  document.getElementById('btn-settings').addEventListener('click', async () => {
    modal.classList.remove('hidden');
    const settings = await sharedLoad('load_settings', 'settings');
    if (settings) {
      if (settings.gemini_api_key) document.getElementById('api-key').value = settings.gemini_api_key;
      if (settings.ai_model) document.getElementById('ai-model').value = settings.ai_model;
      const names = settings.account_names || [];
      document.querySelectorAll('.account-name-input').forEach(input => {
        const i = parseInt(input.dataset.index);
        if (names[i]) input.value = names[i];
      });
    }
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => modal.classList.add('hidden'));
  modal.querySelector('.modal-overlay').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const key = document.getElementById('api-key').value.trim();
    const model = document.getElementById('ai-model').value;
    const names = [];
    document.querySelectorAll('.account-name-input').forEach(input => {
      names[parseInt(input.dataset.index)] = input.value.trim();
    });
    if (!key) { showToast('請輸入 API Key', 'error'); return; }

    const settings = { gemini_api_key: key, ai_model: model, account_names: names };
    await sharedSave('save_settings', 'settings', settings);
    showToast('設定已儲存！', 'success');
    modal.classList.add('hidden');
    updateAccountLabels(names);
  });
}

function updateAccountLabels(names) {
  if (!names) return;
  document.querySelectorAll('.account-fill-name').forEach(el => {
    const i = parseInt(el.dataset.index);
    const letter = ACCOUNT_LETTERS[i];
    const custom = names[i];
    el.textContent = custom ? `${letter} - ${custom}` : `${letter} 帳號${i === 0 ? '（原始）' : ''}`;
  });
}

// ========== 步驟一：擷取 ==========
function initCapture() {
  document.getElementById('btn-capture').addEventListener('click', async () => {
    const statusEl = document.getElementById('capture-status');
    statusEl.className = 'status-msg info';
    statusEl.textContent = '正在擷取頁面資料...';
    statusEl.classList.remove('hidden');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url.includes('seller.shopee.tw')) {
        throw new Error('請先開啟蝦皮賣家中心的商品頁面');
      }

      const response = await sendToContent({ action: 'capture' });
      if (!response || !response.success) {
        throw new Error(response?.error || '擷取失敗');
      }

      const capturedData = response.data;
      capturedData.capturedAt = new Date().toLocaleString('zh-TW');
      await sharedSave('save_product', 'captured_product', capturedData);

      statusEl.className = 'status-msg success';
      statusEl.textContent = `✅ 擷取成功！商品名稱：${capturedData.name || '(空)'}`;
      document.getElementById('title-0').value = capturedData.name || '';
      updateDataView(capturedData);
      showToast('商品資料已擷取並儲存！', 'success');

    } catch (err) {
      statusEl.className = 'status-msg error';
      statusEl.textContent = `❌ ${err.message}`;
    }
  });
}

// ========== 步驟二：AI 生成標題 ==========
function initAI() {
  document.getElementById('btn-ai-generate').addEventListener('click', generateTitles);
}

async function generateTitles() {
  const settings = await sharedLoad('load_settings', 'settings');
  let apiKey = settings?.gemini_api_key || '';
  let model = settings?.ai_model || 'gemini-2.5-flash';
  if (model === 'gemini-2.5-pro-preview-05-06') model = 'gemini-2.5-pro';

  if (!apiKey) { showToast('請先在設定中填入 Gemini API Key', 'error'); return; }

  let originalTitle = document.getElementById('title-0').value.trim();
  let description = '';

  if (!originalTitle) {
    const product = await sharedLoad('load_product', 'captured_product');
    originalTitle = product?.name || '';
    description = product?.description || '';
  }

  if (!originalTitle) { showToast('請先擷取商品資料（步驟 1）', 'error'); return; }

  const style = document.getElementById('ai-style').value;
  const extra = document.getElementById('ai-extra-prompt').value.trim();

  document.getElementById('ai-loading').classList.remove('hidden');
  document.getElementById('btn-ai-generate').disabled = true;

  const styleMap = {
    standard: '標準電商風格，簡潔明瞭，突出關鍵字和賣點',
    emotional: '情感訴求型，打動消費者，強調使用場景',
    professional: '專業規格型，強調參數和品質',
    youth: '年輕活潑型，使用流行語和口語化表達',
    luxury: '高端質感型，用字精煉，營造高級感'
  };

  const prompt = `你是台灣蝦皮電商的商品標題專家。

原始商品標題：「${originalTitle}」
${description ? `商品描述重點：${(typeof description === 'string' ? description : description.text || '').substring(0, 300)}` : ''}
${extra ? `額外要求：${extra}` : ''}

請根據以上資訊，生成 4 組完全不同的商品標題，用於 4 個不同的蝦皮賣場。

核心要求：
- 每個標題都必須明顯不同，用字和排列方式要有差異，避免被蝦皮偵測為重複上架
- 以「高搜尋率、高點擊率、容易被搜尋到」為最優先
- 蝦皮標題字數需介於 25~100 字之間（含空格和符號）
- 要包含原始標題中的核心關鍵字，但順序和搭配方式不同
- 風格：${styleMap[style]}
- 使用繁體中文

你必須只回覆一個 JSON 陣列，不要加任何其他文字、不要加 markdown 標記、不要加說明。
格式範例：["標題一", "標題二", "標題三", "標題四"]
注意：每個標題都是完整的字串，不要有換行。直接回覆 JSON 陣列即可。`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API 錯誤 ${response.status}`);
    }

    const data = await response.json();
    let content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[蝦皮助手] AI 原始回傳:', content);

    if (!content) {
      const blockReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || '';
      throw new Error('AI 沒有回傳內容' + (blockReason ? '（原因: ' + blockReason + '）' : '，請重試'));
    }

    content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const startIdx = content.indexOf('[');
    const endIdx = content.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      content = content.substring(startIdx, endIdx + 1);
    }

    let titles;
    try {
      titles = JSON.parse(content);
    } catch (parseErr) {
      content = content.replace(/[\uFEFF\u200B\u200C\u200D]/g, '');
      try { titles = JSON.parse(content); } catch (e) {}

      if (!titles) {
        const lastQuote = content.lastIndexOf('"');
        if (lastQuote > 0) {
          try { titles = JSON.parse(content.substring(0, lastQuote + 1) + ']'); } catch (e) {}
        }
      }

      if (!titles) {
        const matches = content.match(/"([^"]{10,})"/g);
        if (matches && matches.length >= 2) {
          titles = matches.map(m => m.replace(/^"|"$/g, ''));
        } else {
          console.error('[蝦皮助手] AI 解析失敗:', content);
          throw new Error('AI 回傳格式無法解析，請重試');
        }
      }
    }

    if (!Array.isArray(titles)) throw new Error('AI 回傳格式不正確，請重試');

    if (titles.length < 4) {
      const suffixes = ['【限時特惠】', '【現貨速發】', '【品質保證】', '【熱銷推薦】'];
      while (titles.length < 4) {
        titles.push(suffixes[titles.length % suffixes.length] + ' ' + originalTitle);
      }
    }

    const allTitles = [originalTitle, ...titles.slice(0, 4)];
    await sharedSave('save_titles', 'generated_titles', allTitles);
    displayTitles(allTitles);
    showToast('✅ 4 組標題已生成！', 'success');

  } catch (err) {
    showToast(`生成失敗：${err.message}`, 'error');
    console.error('AI error:', err);
  } finally {
    document.getElementById('ai-loading').classList.add('hidden');
    document.getElementById('btn-ai-generate').disabled = false;
  }
}

function displayTitles(titles) {
  document.getElementById('no-titles-msg').classList.add('hidden');
  document.getElementById('titles-list').classList.remove('hidden');
  document.getElementById('btn-save-titles').classList.remove('hidden');
  titles.forEach((t, i) => {
    const input = document.getElementById(`title-${i}`);
    if (input) { input.value = t; updateCharCount(i); }
  });
}

// ========== 標題管理 ==========
function initTitles() {
  for (let i = 1; i <= 4; i++) {
    const input = document.getElementById(`title-${i}`);
    if (input) input.addEventListener('input', () => updateCharCount(i));
  }

  document.getElementById('btn-save-titles').addEventListener('click', async () => {
    const titles = [];
    for (let i = 0; i <= 4; i++) titles[i] = document.getElementById(`title-${i}`).value;
    await sharedSave('save_titles', 'generated_titles', titles);
    showToast('標題已儲存！', 'success');
  });
}

function updateCharCount(index) {
  const input = document.getElementById(`title-${index}`);
  const countEl = document.querySelector(`.char-count[data-for="title-${index}"]`);
  if (input && countEl) {
    const len = input.value.length;
    countEl.textContent = `${len}/100`;
    countEl.style.color = (len < 25 || len > 100) ? '#E74C3C' : '#999';
  }
}

// ========== 步驟三：填入 ==========
function initFill() {
  document.querySelectorAll('.btn-fill-account').forEach(btn => {
    btn.addEventListener('click', () => fillToPage(parseInt(btn.dataset.index), btn));
  });
}

async function fillToPage(accountIndex, btnEl) {
  const productData = await sharedLoad('load_product', 'captured_product');
  const titles = await sharedLoad('load_titles', 'generated_titles');

  if (!productData || !productData.name) {
    showToast('請先在 A 帳號擷取商品資料（步驟 1）', 'error');
    return;
  }

  const fillData = { ...productData };
  if (titles && titles[accountIndex]) {
    fillData.name = titles[accountIndex];
  }

  btnEl.disabled = true;
  btnEl.textContent = '⏳ 填入中...';

  try {
    const response = await sendToContent({ action: 'fill', data: fillData });
    if (response?.success) {
      btnEl.textContent = '✅ 已填入';
      btnEl.className = 'btn btn-accent btn-sm';
      showToast(`已填入 ${ACCOUNT_LETTERS[accountIndex]} 帳號的資料！`, 'success');
    } else {
      throw new Error(response?.error || '填入失敗');
    }
  } catch (err) {
    showToast(`填入失敗：${err.message}`, 'error');
    btnEl.textContent = '⚡ 填入';
    btnEl.disabled = false;
  }
}

// ========== 已擷取資料頁 ==========
function initDataView() {
  document.getElementById('btn-clear-data')?.addEventListener('click', async () => {
    await sharedSave('save_product', 'captured_product', {});
    await sharedSave('save_titles', 'generated_titles', []);
    document.getElementById('captured-data').classList.add('hidden');
    document.getElementById('no-data-msg').classList.remove('hidden');
    document.getElementById('no-titles-msg').classList.remove('hidden');
    document.getElementById('titles-list').classList.add('hidden');
    document.getElementById('btn-save-titles').classList.add('hidden');
    document.getElementById('capture-status').classList.add('hidden');
    showToast('資料已清除', 'success');
  });

  document.getElementById('btn-refresh-data')?.addEventListener('click', async () => {
    const product = await sharedLoad('load_product', 'captured_product');
    if (product && product.name) {
      updateDataView(product);
      showToast('資料已重新讀取', 'success');
    } else {
      showToast('尚未擷取任何商品資料', 'error');
    }
  });
}

function updateDataView(data) {
  if (!data || !data.name) return;
  document.getElementById('no-data-msg').classList.add('hidden');
  document.getElementById('captured-data').classList.remove('hidden');
  document.getElementById('data-name').textContent = data.name || '-';
  document.getElementById('data-category').textContent = data.category || '-';
  document.getElementById('data-time').textContent = data.capturedAt || '-';

  // 商品描述
  const descEl = document.getElementById('data-desc');
  if (descEl) descEl.textContent = data.description ? (typeof data.description === 'string' ? data.description : data.description.text || '').substring(0, 200) : '-';

  // 規格款式
  const variationsEl = document.getElementById('data-variations');
  if (variationsEl) {
    if (data.variations && data.variations.length > 0) {
      variationsEl.innerHTML = data.variations.map(v =>
        `<div><strong>${v.name}</strong>：${v.options?.join('、') || '(無)'}</div>`
      ).join('');
    } else {
      variationsEl.textContent = '無規格';
    }
  }

  // 價格 / 庫存
  const priceEl = document.getElementById('data-price');
  if (priceEl) {
    if (data.pricingTable && data.pricingTable.length > 0) {
      const count = data.pricingTable.length;
      const prices = data.pricingTable.map(r => r.price).filter(Boolean);
      const minP = prices.length ? Math.min(...prices) : '-';
      const maxP = prices.length ? Math.max(...prices) : '-';
      priceEl.textContent = `${count} 組定價（$${minP} ~ $${maxP}）`;
    } else {
      priceEl.textContent = '-';
    }
  }

  // 物流設定
  const logisticsEl = document.getElementById('data-logistics');
  if (logisticsEl) {
    if (data.logistics && data.logistics.length > 0) {
      logisticsEl.textContent = data.logistics.join('、');
    } else if (data.weight) {
      logisticsEl.textContent = `重量: ${data.weight}`;
    } else {
      logisticsEl.textContent = '-';
    }
  }
}

// ========== Toast ==========
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function createToastContainer() {
  const c = document.createElement('div');
  c.id = 'toast-container';
  c.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:6px;';
  document.body.appendChild(c);
  return c;
}
