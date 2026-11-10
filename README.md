# 智慧树新形态 AI 课程全自动伴学脚本 🌲

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Script Version](https://img.shields.io/badge/version-3.1.0-green.svg)](zhihuishu_auto_study.user.js)
[![Platform](https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey%20%7C%20ScriptCat-orange.svg)](zhihuishu_auto_study.user.js)

专为**智慧树（知到）新形态 AI 课程**全流程打造的学习体验增强用户脚本（UserScript）。支持智能静音播放、多倍速控制、章节自动展开与切节、AI 与本地题库双擎答题闭环及可拖拽控制面板。

---

## 🌟 核心特性

- 🎬 **智能视频学习增强**：支持自动 1.5x 倍速播放、智能静音、防重复播放逻辑；自动检测并智能跳过已满进度的章节。
- 🔄 **智能章节树自动穿透**：深度递归检测当前课程大纲目录，自动展开收起的章节，视频播放完毕后自动定位并无缝切换至下一有效小节。
- 📝 **AI + 本地双引擎智能答题**：针对章节测验与课后练习，支持智能解析题目与选项，具备防循环刷题保护机制。
- 🌐 **跨子域状态同步机制**：打通智慧树新版智能课程后台（`ai-smart-course-student-pro`）与考试测验系统（`studentexamcomh5`）之间的状态与进度同步。
- 🎛️ **可视化悬浮控制面板**：常态待机与一键启停，可自由拖拽放置在屏幕任意位置，实时显示当前运行状态与操作日志。

---

## 🚀 快速安装

### 步骤 1：安装脚本管理器扩展
如果你的浏览器尚未安装油猴插件，请先安装以下任一主流扩展：
- [Tampermonkey（篡改猴）官网](https://www.tampermonkey.net/)
- [ScriptCat（脚本猫）官网](https://scriptcat.org/)
- [Violentmonkey（暴力猴）官网](https://violentmonkey.github.io/)

### 步骤 2：安装本脚本
点击下方链接，脚本管理器将自动识别并弹出安装确认界面：

👉 **[点击直接安装脚本 (Raw Install)](https://raw.githubusercontent.com/baiyi116/zhihuishu-auto-study/main/zhihuishu_auto_study.user.js)**

*(如果遇到国内网络访问 GitHub 较慢的情况，可在扩展管理器的「添加新脚本」界面中，直接将 `zhihuishu_auto_study.user.js` 的完整代码复制粘贴保存即可)*

---

## 📖 使用说明

1. 使用 Edge / Chrome 等浏览器登录 [智慧树（知到）](https://www.zhihuishu.com/)。
2. 进入任意课程的学习主页或播放页。
3. 页面右侧将自动浮现 **【智慧树AI伴学】悬浮控制面板**。
4. 点击面板中的 **「开始运行」**，脚本将自动接管后续的播放与切节任务。

---

## ⚠️ 免责声明 (Disclaimer)

1. 本项目仅供前端脚本自动化、DOM 交互与网页逆向技术的**个人学习、研究与交流使用**。
2. 请合理合规使用本工具，切勿用于破坏教学考务秩序或进行商业牟利。
3. 使用本脚本所产生的一切后果由使用者自行承担，作者不对任何因使用本软件造成的账号异常或损失负责。

---

## 📄 开源协议

本项目基于 [MIT 协议](LICENSE) 开源。
