# 🚀 我的浏览器扩展合集 (Browser Extensions)

收录个人开发维护的各类实用浏览器扩展（基于 Chrome Extensions Manifest V3 标准）。兼容 Chrome、Edge、Brave 等主流 Chromium 内核浏览器。

---

## 📦 插件列表 (Extensions)

| 插件名称 | 文件夹路径 | 版本 | 核心功能 |
| :--- | :--- | :--- | :--- |
| **QR 框选扫描器** | [`extensions/qr-scanner`](./extensions/qr-scanner) | `v1.0.1` | 点击图标在网页任意区域框选扫描二维码，秒级提取链接并一键打开/复制 |
| *(待添加...)* | `extensions/...` | - | 持续更新中 |

---

## 🛠️ 通用安装使用教程 (开发者模式)

由于这些是个人开源的扩展源码，无需通过应用商店，直接使用**「开发者模式」**即可一键加载：

1. **下载或克隆本仓库**：
   ```bash
   git clone https://github.com/你的用户名/你的仓库名.git
   ```
2. **打开浏览器的扩展管理页**：
   - **Google Chrome**: 访问 `chrome://extensions/`
   - **Microsoft Edge**: 访问 `edge://extensions/`
3. **开启右上角的【开发者模式】开关**。
4. **点击左上角【加载已解压的扩展程序】（Load unpacked）**。
5. **选择你要安装的插件子目录**（例如：选择 `extensions/qr-scanner` 文件夹，**切勿直接选择仓库根目录**）。
6. 点击浏览器右上角的 🧩 拼图图标，把插件固定到工具栏即可开始使用！

---

## 🤝 贡献与反馈
如果你在使用过程中发现任何 Bug 或有新功能建议，欢迎提交 [Issues](../../issues) 或发起 [Pull Requests](../../pulls)。

## 📄 开源许可
本项目遵循 [MIT 许可证](./LICENSE)。
