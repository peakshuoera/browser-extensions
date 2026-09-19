// content.js - 前端页面交互与框选解码

(function () {
  /**
   * 暴露全局启动方法供 background 调用
   */
  window.__startQrScanner = function (screenshotUrl) {
    startSelection(screenshotUrl);
  };

  window.__scanImageUrl = function (imageUrl) {
    scanImageUrl(imageUrl);
  };

  /**
   * 启动鼠标框选交互
   */
  function startSelection(screenshotUrl) {
    // 移除已有的扫描容器
    removeExistingRoot();

    const root = document.createElement('div');
    root.id = 'qr-scanner-extension-root';
    const shadow = root.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(root);

    // 注入 UI 样式
    const style = document.createElement('style');
    style.textContent = getStyles();
    shadow.appendChild(style);

    // 创建遮罩与提示层
    const overlay = document.createElement('div');
    overlay.className = 'qr-overlay';

    overlay.innerHTML = `
      <div class="qr-tip-bar">
        <span class="qr-tip-icon">⛶</span>
        <span>按住鼠标左键<strong>拖拽框选</strong>二维码</span>
        <span class="qr-tip-badge">按 ESC / 右键 取消</span>
      </div>
      <div class="qr-selection-box" style="display: none;">
        <span class="corner corner-tl"></span>
        <span class="corner corner-tr"></span>
        <span class="corner corner-bl"></span>
        <span class="corner corner-br"></span>
        <div class="qr-size-badge">0 × 0</div>
      </div>
    `;
    shadow.appendChild(overlay);

    const selectionBox = overlay.querySelector('.qr-selection-box');
    const sizeBadge = overlay.querySelector('.qr-size-badge');

    let isSelecting = false;
    let startX = 0;
    let startY = 0;
    let currentRect = null;

    // 鼠标按下：记录起点
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;

      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
      selectionBox.style.display = 'block';
    };

    // 鼠标移动：更新选区矩形
    const onMouseMove = (e) => {
      if (!isSelecting) return;
      e.preventDefault();
      e.stopPropagation();

      const currentX = e.clientX;
      const currentY = e.clientY;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      currentRect = { left, top, width, height };

      selectionBox.style.left = `${left}px`;
      selectionBox.style.top = `${top}px`;
      selectionBox.style.width = `${width}px`;
      selectionBox.style.height = `${height}px`;

      sizeBadge.textContent = `${Math.round(width)} × ${Math.round(height)}`;
    };

    // 鼠标松开：完成框选，开始裁剪解析
    const onMouseUp = (e) => {
      if (!isSelecting) return;
      isSelecting = false;

      // 如果拖拽范围过小（如误点），忽略并不关闭遮罩
      if (!currentRect || currentRect.width < 15 || currentRect.height < 15) {
        selectionBox.style.display = 'none';
        return;
      }

      cleanupEvents();
      overlay.remove();

      cropAndDecode(screenshotUrl, currentRect, shadow, () => {
        startSelection(screenshotUrl);
      });
    };

    // 键盘 ESC 取消
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        cleanupEvents();
        removeExistingRoot();
      }
    };

    // 右键点击取消
    const onContextMenu = (e) => {
      e.preventDefault();
      cleanupEvents();
      removeExistingRoot();
    };

    function cleanupEvents() {
      overlay.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      overlay.removeEventListener('contextmenu', onContextMenu);
    }

    overlay.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('contextmenu', onContextMenu);
  }

  /**
   * 将截图中选定区域裁剪并送入 jsQR 解析
   */
  function cropAndDecode(screenshotUrl, rect, shadow, onRetry) {
    showLoadingModal(shadow);

    const img = new Image();
    img.onload = () => {
      try {
        const scaleX = img.naturalWidth / window.innerWidth;
        const scaleY = img.naturalHeight / window.innerHeight;

        const cropX = rect.left * scaleX;
        const cropY = rect.top * scaleY;
        const cropW = rect.width * scaleX;
        const cropH = rect.height * scaleY;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(cropW));
        canvas.height = Math.max(1, Math.round(cropH));

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        performDecode(canvas, shadow, onRetry);
      } catch (err) {
        console.error('裁剪解析异常:', err);
        showResultModal(null, shadow, onRetry);
      }
    };

    img.onerror = () => {
      showResultModal(null, shadow, onRetry);
    };

    img.src = screenshotUrl;
  }

  /**
   * 解析 Canvas 图像中的二维码
   */
  async function performDecode(canvas, shadow, onRetry) {
    let result = null;

    if (typeof jsQR !== 'undefined') {
      try {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          result = code.data;
        }
      } catch (e) {
        console.warn('jsQR 识别异常:', e);
      }
    }

    if (!result && 'BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const detected = await detector.detect(canvas);
        if (detected && detected.length > 0 && detected[0].rawValue) {
          result = detected[0].rawValue;
        }
      } catch (e) {}
    }

    showResultModal(result, shadow, onRetry);
  }

  /**
   * 识别图片 URL
   */
  function scanImageUrl(imageUrl) {
    removeExistingRoot();

    const root = document.createElement('div');
    root.id = 'qr-scanner-extension-root';
    const shadow = root.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(root);

    const style = document.createElement('style');
    style.textContent = getStyles();
    shadow.appendChild(style);

    showLoadingModal(shadow);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      performDecode(canvas, shadow, null);
    };
    img.onerror = () => {
      showResultModal(null, shadow, null);
    };
    img.src = imageUrl;
  }

  function removeExistingRoot() {
    const existing = document.getElementById('qr-scanner-extension-root');
    if (existing) {
      existing.remove();
    }
  }

  function showLoadingModal(shadow) {
    const prev = shadow.querySelector('.qr-modal-backdrop');
    if (prev) prev.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'qr-modal-backdrop';
    backdrop.innerHTML = `
      <div class="qr-modal qr-loading-modal">
        <div class="qr-spinner"></div>
        <div class="qr-loading-text">正在识别二维码...</div>
      </div>
    `;
    shadow.appendChild(backdrop);
  }

  function showResultModal(text, shadow, onRetry) {
    const prev = shadow.querySelector('.qr-modal-backdrop');
    if (prev) prev.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'qr-modal-backdrop';

    const isSuccess = !!text;
    let isUrl = false;
    let openUrl = text || '';

    if (isSuccess) {
      const trimmed = text.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        isUrl = true;
        openUrl = trimmed;
      } else if (/^[a-zA-Z0-9][-a-zA-Z0-9]{0,62}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})+(\/[^\s]*)?$/.test(trimmed)) {
        isUrl = true;
        openUrl = 'https://' + trimmed;
      }
    }

    const modal = document.createElement('div');
    modal.className = 'qr-modal';

    if (isSuccess) {
      modal.innerHTML = `
        <div class="qr-modal-header">
          <div class="qr-modal-title">
            <span class="qr-icon-success">✓</span>
            <span>识别成功</span>
            <span class="qr-tag ${isUrl ? 'qr-tag-url' : 'qr-tag-text'}">${isUrl ? '网页链接' : '文本内容'}</span>
          </div>
          <button class="qr-close-btn" title="关闭 (Esc)">×</button>
        </div>

        <div class="qr-modal-body">
          <div class="qr-result-box" id="qr-result-content" title="点击全选">${escapeHtml(text)}</div>
        </div>

        <div class="qr-modal-footer">
          ${isUrl ? `<button class="qr-btn qr-btn-primary" id="qr-open-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            打开链接
          </button>` : ''}
          <button class="qr-btn ${isUrl ? 'qr-btn-secondary' : 'qr-btn-primary'}" id="qr-copy-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            复制${isUrl ? '链接' : '内容'}
          </button>
          ${onRetry ? `<button class="qr-btn qr-btn-ghost" id="qr-retry-btn">重新框选</button>` : ''}
        </div>
      `;
    } else {
      modal.innerHTML = `
        <div class="qr-modal-header">
          <div class="qr-modal-title">
            <span class="qr-icon-warn">!</span>
            <span>未识别到二维码</span>
          </div>
          <button class="qr-close-btn" title="关闭 (Esc)">×</button>
        </div>

        <div class="qr-modal-body">
          <div class="qr-fail-box">
            <p class="qr-fail-title">在框选区域内没有检测到有效二维码：</p>
            <ul class="qr-fail-tips">
              <li>请确保框选范围<strong>包含完整的二维码图像</strong></li>
              <li>建议框选时在四周<strong>保留一圈白色边框</strong>（Quiet Zone）</li>
              <li>如果二维码较小，可使用快捷键 <code>Ctrl + 滚轮</code> 放大网页后再次框选</li>
            </ul>
          </div>
        </div>

        <div class="qr-modal-footer">
          ${onRetry ? `<button class="qr-btn qr-btn-primary" id="qr-retry-btn">重新框选</button>` : ''}
          <button class="qr-btn qr-btn-ghost" id="qr-cancel-btn">关闭</button>
        </div>
      `;
    }

    backdrop.appendChild(modal);
    shadow.appendChild(backdrop);

    const closeBtn = modal.querySelector('.qr-close-btn');
    if (closeBtn) closeBtn.onclick = () => removeExistingRoot();

    const cancelBtn = modal.querySelector('#qr-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => removeExistingRoot();

    backdrop.onclick = (e) => {
      if (e.target === backdrop) removeExistingRoot();
    };

    const escListener = (e) => {
      if (e.key === 'Escape') {
        removeExistingRoot();
        window.removeEventListener('keydown', escListener);
      }
    };
    window.addEventListener('keydown', escListener);

    const openBtn = modal.querySelector('#qr-open-btn');
    if (openBtn) {
      openBtn.onclick = () => {
        window.open(openUrl, '_blank', 'noopener,noreferrer');
      };
    }

    const copyBtn = modal.querySelector('#qr-copy-btn');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(text);
          const origHtml = copyBtn.innerHTML;
          copyBtn.innerHTML = `<span>✓ 已复制到剪贴板</span>`;
          copyBtn.classList.add('qr-btn-success');
          setTimeout(() => {
            copyBtn.innerHTML = origHtml;
            copyBtn.classList.remove('qr-btn-success');
          }, 2000);
        } catch (e) {
          fallbackCopyText(text);
          copyBtn.textContent = '已复制!';
          setTimeout(() => {
            copyBtn.textContent = isUrl ? '复制链接' : '复制内容';
          }, 2000);
        }
      };
    }

    const resultBox = modal.querySelector('#qr-result-content');
    if (resultBox) {
      resultBox.onclick = () => {
        const range = document.createRange();
        range.selectNodeContents(resultBox);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      };
    }

    const retryBtn = modal.querySelector('#qr-retry-btn');
    if (retryBtn && onRetry) {
      retryBtn.onclick = () => {
        removeExistingRoot();
        onRetry();
      };
    }
  }

  function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getStyles() {
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .qr-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        cursor: crosshair;
        user-select: none;
        background: rgba(0, 0, 0, 0.45);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      .qr-tip-bar {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.9);
        color: #ffffff;
        padding: 10px 20px;
        border-radius: 9999px;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15);
        pointer-events: none;
        backdrop-filter: blur(8px);
        letter-spacing: 0.3px;
      }

      .qr-tip-icon {
        font-size: 16px;
        color: #60a5fa;
      }

      .qr-tip-badge {
        background: rgba(255, 255, 255, 0.18);
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 12px;
        color: #d1d5db;
      }

      .qr-selection-box {
        position: fixed;
        border: 2px solid #3b82f6;
        box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.45), inset 0 0 12px rgba(59, 130, 246, 0.3);
        pointer-events: none;
        z-index: 2147483647;
        border-radius: 4px;
      }

      .corner {
        position: absolute;
        width: 12px;
        height: 12px;
        border-color: #60a5fa;
        border-style: solid;
      }
      .corner-tl { top: -2px; left: -2px; border-width: 3px 0 0 3px; border-top-left-radius: 4px; }
      .corner-tr { top: -2px; right: -2px; border-width: 3px 3px 0 0; border-top-right-radius: 4px; }
      .corner-bl { bottom: -2px; left: -2px; border-width: 0 0 3px 3px; border-bottom-left-radius: 4px; }
      .corner-br { bottom: -2px; right: -2px; border-width: 0 3px 3px 0; border-bottom-right-radius: 4px; }

      .qr-size-badge {
        position: absolute;
        bottom: -28px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.85);
        color: #93c5fd;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 4px;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .qr-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        animation: qr-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes qr-fade-in {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }

      .qr-modal {
        background: #ffffff;
        width: 100%;
        max-width: 480px;
        border-radius: 14px;
        box-shadow: 0 20px 35px -5px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.05);
        overflow: hidden;
        color: #1e293b;
      }

      .qr-loading-modal {
        max-width: 240px;
        padding: 30px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .qr-spinner {
        width: 36px;
        height: 36px;
        border: 3px solid #e2e8f0;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: qr-spin 0.8s linear infinite;
      }

      @keyframes qr-spin {
        to { transform: rotate(360deg); }
      }

      .qr-loading-text {
        font-size: 14px;
        color: #64748b;
        font-weight: 500;
      }

      .qr-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid #f1f5f9;
      }

      .qr-modal-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 16px;
        font-weight: 600;
        color: #0f172a;
      }

      .qr-icon-success {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        background: #dcfce7;
        color: #15803d;
        border-radius: 50%;
        font-size: 13px;
        font-weight: bold;
      }

      .qr-icon-warn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        background: #fee2e2;
        color: #b91c1c;
        border-radius: 50%;
        font-size: 13px;
        font-weight: bold;
      }

      .qr-tag {
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 4px;
        font-weight: 500;
      }
      .qr-tag-url {
        background: #eff6ff;
        color: #2563eb;
      }
      .qr-tag-text {
        background: #f1f5f9;
        color: #475569;
      }

      .qr-close-btn {
        background: transparent;
        border: none;
        font-size: 20px;
        line-height: 1;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 6px;
        transition: all 0.15s;
      }
      .qr-close-btn:hover {
        background: #f1f5f9;
        color: #334155;
      }

      .qr-modal-body {
        padding: 18px 20px;
      }

      .qr-result-box {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 14px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        line-height: 1.6;
        color: #0f172a;
        word-break: break-all;
        max-height: 200px;
        overflow-y: auto;
        cursor: text;
        user-select: text;
      }

      .qr-fail-box {
        color: #475569;
        font-size: 14px;
        line-height: 1.6;
      }
      .qr-fail-title {
        font-weight: 600;
        color: #334155;
        margin-bottom: 8px;
      }
      .qr-fail-tips {
        padding-left: 20px;
        font-size: 13px;
        color: #64748b;
      }
      .qr-fail-tips li {
        margin-bottom: 5px;
      }
      .qr-fail-tips code {
        background: #f1f5f9;
        padding: 1px 5px;
        border-radius: 3px;
        color: #2563eb;
      }

      .qr-modal-footer {
        padding: 14px 20px;
        background: #f8fafc;
        border-top: 1px solid #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
      }

      .qr-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: 7px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        border: 1px solid transparent;
        outline: none;
      }

      .qr-btn-primary {
        background: #2563eb;
        color: #ffffff;
      }
      .qr-btn-primary:hover {
        background: #1d4ed8;
      }

      .qr-btn-secondary {
        background: #ffffff;
        color: #334155;
        border-color: #cbd5e1;
      }
      .qr-btn-secondary:hover {
        background: #f1f5f9;
        border-color: #94a3b8;
      }

      .qr-btn-ghost {
        background: transparent;
        color: #64748b;
      }
      .qr-btn-ghost:hover {
        background: #f1f5f9;
        color: #1e293b;
      }

      .qr-btn-success {
        background: #10b981 !important;
        color: #ffffff !important;
        border-color: #10b981 !important;
      }
    `;
  }
})();
