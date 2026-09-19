// background.js - 核心后台逻辑

// 监听扩展图标点击（以及 Alt+Q 快捷键触发）
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const currentUrl = tab.url || '';

  // 1. 检查是否为浏览器内部受限页面 (chrome://, edge://, about:, 等)
  const restrictedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'devtools://',
    'view-source:',
    'https://chrome.google.com/webstore'
  ];

  if (!currentUrl || restrictedPrefixes.some(prefix => currentUrl.startsWith(prefix))) {
    // 浏览器安全策略严禁在内部扩展页运行脚本，打开引导页帮助用户了解与测试
    chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
    return;
  }

  // 2. 检查本地文件 (file://) 是否开启了访问权限
  if (currentUrl.startsWith('file://')) {
    const isAllowed = await chrome.extension.isAllowedFileSchemeAccess();
    if (!isAllowed) {
      // 未开启“允许访问文件网址”权限，打开指引
      chrome.tabs.create({ url: chrome.runtime.getURL('guide.html?reason=file_access') });
      return;
    }
  }

  try {
    // 3. 截取当前标签页的可视区域 (null 代表当前活动窗口)
    const screenshotUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    if (!screenshotUrl) {
      console.error('截屏数据为空');
      return;
    }

    // 4. 注入解码库与 content 脚本 (若已注入会自动覆盖更新)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['jsqr.min.js', 'content.js']
    });

    // 5. 直接在页面执行启动函数，避免 sendMessage 产生时序和端口中断问题
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (url) => {
        if (typeof window.__startQrScanner === 'function') {
          window.__startQrScanner(url);
        } else {
          console.error('__startQrScanner 未就绪');
        }
      },
      args: [screenshotUrl]
    });

  } catch (err) {
    console.error('启动框选失败:', err);
    // 在图标上显示错误角标，提示用户
    chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId: tab.id });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }, 3000);
  }
});

// 支持右键菜单识别图片二维码
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'scan-qr-image',
    title: '识别图片中的二维码',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'scan-qr-image' && tab && tab.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['jsqr.min.js', 'content.js']
      });

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (url) => {
          if (typeof window.__scanImageUrl === 'function') {
            window.__scanImageUrl(url);
          }
        },
        args: [info.srcUrl]
      });
    } catch (err) {
      console.error('右键识别失败:', err);
    }
  }
});
