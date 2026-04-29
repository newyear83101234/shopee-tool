// ===== 蝦皮快速上架助手 v4.1 - Background Service Worker =====
const NATIVE_HOST = 'com.shopee.helper';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.target === 'native') {
      // 轉發到 Native Host
      try {
        chrome.runtime.sendNativeMessage(NATIVE_HOST, msg.payload, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: '本機橋接未安裝：' + chrome.runtime.lastError.message });
          } else {
            sendResponse(response || { success: false, error: '無回應' });
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: '本機橋接未安裝：' + err.message });
      }
      return true;
    }

    if (msg.target === 'content') {
      // 轉發到 content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (tabs && tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, msg.payload, (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: '無法連接到蝦皮頁面，請重新整理頁面後再試' });
            } else {
              sendResponse(response || { success: false, error: '頁面無回應' });
            }
          });
        } else {
          sendResponse({ success: false, error: '找不到當前分頁' });
        }
      });
      return true;
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
    return true;
  }
});
