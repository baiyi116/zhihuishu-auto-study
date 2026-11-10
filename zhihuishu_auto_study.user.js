// ==UserScript==
// @name         智慧树新形态AI课程全自动学习脚本 (全流程闭环+智能切节+AI答题+可拖拽)
// @namespace    https://github.com/baiyi116/zhihuishu-auto-study
// @version      3.1.0
// @description  专为智慧树AIスマート新形态课程打造。常态待机手动启动、自动1.5x静音看课、防重复播放、智能跳过已完成、章节自动展开切节、AI+本地题库双擎稳健答题、防循环刷题闭环。
// @author       baiyi116
// @match        *://*.zhihuishu.com/*
// @updateURL    https://raw.githubusercontent.com/baiyi116/zhihuishu-auto-study/main/zhihuishu_auto_study.user.js
// @downloadURL  https://raw.githubusercontent.com/baiyi116/zhihuishu-auto-study/main/zhihuishu_auto_study.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // 防止在同页面重复注入
    if (window.__ZHS_AUTO_STUDY_INJECTED__) return;
    window.__ZHS_AUTO_STUDY_INJECTED__ = true;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ==========================================
    // 0. 跨子域 Cookie 与本地存储同步工具
    //    (打通 ai-smart-course-student-pro 与 studentexamcomh5)
    // ==========================================
    function setRootCookie(name, value, maxAgeSec = 86400 * 30) {
        try {
            document.cookie = `${name}=${encodeURIComponent(value)}; domain=.zhihuishu.com; path=/; max-age=${maxAgeSec}; SameSite=Lax`;
        } catch (e) {}
    }

    function getRootCookie(name) {
        try {
            const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
            return match ? decodeURIComponent(match[1]) : null;
        } catch (e) {
            return null;
        }
    }

    // 运行状态管理：默认常态关闭（待机），仅在手动点击启动后运行，并通过心跳 Cookie 保持跨子域跳页连续运行
    function checkInitialRunningState() {
        const runningFlag = getRootCookie('ZHS_AUTO_RUNNING');
        const lastBeat = parseInt(getRootCookie('ZHS_AUTO_BEAT') || '0', 10);
        const now = Date.now();
        // 只有当明确处于运行态，且距离上一个页面的心跳不足 25 秒（即正常自动跳页过程）才自动延续运行
        if (runningFlag === '1' && now - lastBeat < 25000) {
            setRootCookie('ZHS_AUTO_BEAT', String(now), 3600);
            return true;
        }
        // 否则一律进入“常态关闭/待机”状态，需用户手动启动
        setRootCookie('ZHS_AUTO_RUNNING', '0', 3600);
        return false;
    }

    window.__zhs_paused = !checkInitialRunningState();

    function setScriptRunning(isRunning) {
        window.__zhs_paused = !isRunning;
        setRootCookie('ZHS_AUTO_RUNNING', isRunning ? '1' : '0', 3600);
        if (isRunning) {
            setRootCookie('ZHS_AUTO_BEAT', String(Date.now()), 3600);
        }
        updatePanelRunningUI();
    }

    // ==========================================
    // 1. 配置读取与持久化模块 (留空默认 AI 接口，跨子域同步)
    // ==========================================
    const DEFAULT_CONFIG = {
        playbackRate: 1.5,          // 默认倍速 (1.5x 最稳妥)
        muted: true,                // 默认静音
        autoAnswer: true,           // 是否自动完成章节练习题
        skipCompleted: true,        // 自动跳过已完成的内容与章节
        aiApiUrl: '',               // 留空，支持跨子域同步
        aiApiKey: '',               // 留空，支持跨子域同步
        aiModel: '',                // 留空，支持跨子域同步
        intervalCheck: 2000,        // 主循环检测间隔 (毫秒)
        answerDelay: 1200           // 答题翻页间隔 (毫秒)
    };

    function loadConfig() {
        let localCfg = {};
        let cookieCfg = {};
        try {
            const saved = localStorage.getItem('ZHS_AUTO_CONFIG');
            if (saved) localCfg = JSON.parse(saved);
        } catch (e) {}
        try {
            const cSaved = getRootCookie('ZHS_AUTO_CONFIG_SYNC');
            if (cSaved) cookieCfg = JSON.parse(cSaved);
        } catch (e) {}

        // 优先合并非空的 AI 配置，实现跨子域共享
        const merged = { ...DEFAULT_CONFIG, ...cookieCfg, ...localCfg };
        if (!merged.aiApiKey && cookieCfg.aiApiKey) merged.aiApiKey = cookieCfg.aiApiKey;
        if (!merged.aiApiUrl && cookieCfg.aiApiUrl) merged.aiApiUrl = cookieCfg.aiApiUrl;
        if (!merged.aiModel && cookieCfg.aiApiModel) merged.aiModel = cookieCfg.aiApiModel;
        if (!merged.aiModel && cookieCfg.aiModel) merged.aiModel = cookieCfg.aiModel;

        try {
            localStorage.setItem('ZHS_AUTO_CONFIG', JSON.stringify(merged));
            setRootCookie('ZHS_AUTO_CONFIG_SYNC', JSON.stringify({
                aiApiUrl: merged.aiApiUrl,
                aiApiKey: merged.aiApiKey,
                aiModel: merged.aiModel,
                skipCompleted: merged.skipCompleted,
                autoAnswer: merged.autoAnswer
            }));
        } catch (e) {}
        return merged;
    }

    function saveConfig(newCfg) {
        try {
            const merged = { ...CONFIG, ...newCfg };
            localStorage.setItem('ZHS_AUTO_CONFIG', JSON.stringify(merged));
            setRootCookie('ZHS_AUTO_CONFIG_SYNC', JSON.stringify({
                aiApiUrl: merged.aiApiUrl,
                aiApiKey: merged.aiApiKey,
                aiModel: merged.aiModel,
                skipCompleted: merged.skipCompleted,
                autoAnswer: merged.autoAnswer
            }));
            Object.assign(CONFIG, merged);
            addLog('配置已保存并跨子域同步');
        } catch (e) {
            console.error('[ZHS-Auto] 保存配置失败:', e);
        }
    }

    const CONFIG = loadConfig();

    // ==========================================
    // 1.5 已完成资源与已测验知识点防重记录 (解决重复播视频 & 循环刷题)
    // ==========================================
    const doneResourcesMem = new Set();

    function getCurrentNodeId() {
        // 从 learnPage/courseId/nodeId/classId 或 point/courseId/classId/testId/pointId 或 ?pointId=xxx 提取
        const url = location.href;
        const qMatch = url.match(/[?&]pointId=([^&#]+)/);
        if (qMatch) return qMatch[1];
        const parts = location.pathname.split('/');
        if (location.pathname.includes('/learnPage/') && parts.length >= 4) {
            return parts[3];
        }
        if (location.pathname.includes('/point/') && parts.length >= 6) {
            return parts[5];
        }
        return 'unknown_node';
    }

    function getCardKey(cardEl) {
        if (!cardEl) return '';
        const title = cardEl.innerText.replace(/已完成|\d+%/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
        return `${getCurrentNodeId()}::${title}`;
    }

    function markResourceDone(cardEl) {
        const key = getCardKey(cardEl);
        if (!key) return;
        doneResourcesMem.add(key);
        try {
            const list = JSON.parse(sessionStorage.getItem('ZHS_DONE_RESOURCES') || '[]');
            if (!list.includes(key)) {
                list.push(key);
                sessionStorage.setItem('ZHS_DONE_RESOURCES', JSON.stringify(list.slice(-200)));
            }
        } catch (e) {}
    }

    function isResourceDone(cardEl) {
        if (!cardEl) return false;
        if (cardEl.innerText.includes('已完成')) return true;
        const key = getCardKey(cardEl);
        if (doneResourcesMem.has(key)) return true;
        try {
            const list = JSON.parse(sessionStorage.getItem('ZHS_DONE_RESOURCES') || '[]');
            return list.includes(key);
        } catch (e) {
            return false;
        }
    }

    function getDoneQuizzes() {
        const set = new Set();
        try {
            const localList = JSON.parse(localStorage.getItem('ZHS_DONE_QUIZZES') || '[]');
            localList.forEach(x => set.add(String(x)));
        } catch (e) {}
        try {
            const cookieList = JSON.parse(getRootCookie('ZHS_DONE_QUIZZES') || '[]');
            cookieList.forEach(x => set.add(String(x)));
        } catch (e) {}
        return set;
    }

    function markQuizDone(nodeOrPointId) {
        if (!nodeOrPointId || nodeOrPointId === 'unknown_node') return;
        const set = getDoneQuizzes();
        set.add(String(nodeOrPointId));
        const arr = Array.from(set).slice(-80);
        try {
            localStorage.setItem('ZHS_DONE_QUIZZES', JSON.stringify(arr));
        } catch (e) {}
        setRootCookie('ZHS_DONE_QUIZZES', JSON.stringify(arr));
    }

    function isQuizDone(nodeOrPointId) {
        if (!nodeOrPointId) return false;
        return getDoneQuizzes().has(String(nodeOrPointId));
    }

    // ==========================================
    // 2. 本地题库缓存模块 (Tiku Cache)
    // ==========================================
    function getTikuCache() {
        try {
            const data = localStorage.getItem('ZHS_TIKU_CACHE');
            return data ? JSON.parse(data) : {};
        } catch (e) {
            return {};
        }
    }

    function saveTikuAnswer(stem, answerText) {
        if (!stem || !answerText) return;
        const cache = getTikuCache();
        const key = stem.replace(/\s+/g, '').slice(0, 60);
        if (cache[key] !== answerText) {
            cache[key] = answerText;
            localStorage.setItem('ZHS_TIKU_CACHE', JSON.stringify(cache));
            addLog(`📥 已收录标准答案: ${answerText}`);
        }
    }

    function queryTiku(stem) {
        const cache = getTikuCache();
        const key = stem.replace(/\s+/g, '').slice(0, 60);
        return cache[key] || null;
    }

    // ==========================================
    // 3. AI 在线解题模块 (支持自动修复接口地址与模型回退)
    // ==========================================
    async function queryAIAnswer(questionType, stem, options) {
        if (!CONFIG.aiApiUrl || !CONFIG.aiApiKey) {
            addLog('⚠️ 未配置 AI 接口，将使用默认保底选项 A');
            return null;
        }

        const optionsText = options.map(o => `${o.letter}. ${o.text}`).join('\n');
        const prompt = `你是一个专业的大学网课考试答题助手。请解答以下${questionType}，并且只返回正确选项的字母（例如单选题返回 A，多选题返回 ABC，判断题返回 A 或 B），严禁输出任何多余的解释文字或标点符号！\n\n题目：${stem}\n选项：\n${optionsText}`;

        let apiUrl = CONFIG.aiApiUrl.trim().replace(/\/+$/, '');
        if (!apiUrl.endsWith('/chat/completions')) {
            if (apiUrl.endsWith('/v1')) {
                apiUrl += '/chat/completions';
            } else {
                apiUrl += '/v1/chat/completions';
            }
        }

        // 构建候选模型列表：若用户填写了 deepseek-flash 但官方接口实为 deepseek-chat，自动回退重试
        const primaryModel = (CONFIG.aiModel || 'deepseek-chat').trim();
        const candidateModels = [primaryModel];
        if (primaryModel.toLowerCase().includes('deepseek') && primaryModel !== 'deepseek-chat') {
            candidateModels.push('deepseek-chat');
        }

        for (const modelName of candidateModels) {
            try {
                addLog(`🤖 正在请求 AI (${modelName})...`);
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${CONFIG.aiApiKey.trim()}`
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [
                            { role: 'system', content: '你是一个严谨的答题机器，只输出选项字母（如 A 或 BC），绝不输出任何其他字符。' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1
                    })
                });

                if (!response.ok) {
                    addLog(`⚠️ AI 模型 ${modelName} 响应 ${response.status}`);
                    continue;
                }

                const data = await response.json();
                const rawReply = data.choices?.[0]?.message?.content?.trim() || '';
                const matched = rawReply.toUpperCase().replace(/[^A-F]/g, '');
                if (matched) {
                    addLog(`✨ AI 解答成功: [${matched}]`);
                    return matched;
                }
            } catch (err) {
                console.error('[ZHS-Auto] AI 请求异常:', err);
                addLog(`❌ AI 请求出错: ${err.message}`);
            }
        }
        return null;
    }

    // ==========================================
    // 4. 防焦点丢失与切屏检测劫持
    // ==========================================
    function injectAntiDetect() {
        try {
            Object.defineProperty(document, 'hidden', { value: false, configurable: true });
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            window.addEventListener('blur', (e) => e.stopImmediatePropagation(), true);
            document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
        } catch (e) {}
    }
    injectAntiDetect();

    // ==========================================
    // 5. 可视化悬浮控制面板 (支持常态待机、手动启动、拖拽、折叠)
    // ==========================================
    const logs = [];
    function addLog(msg) {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const line = `[${time}] ${msg}`;
        if (logs.length > 0 && logs[logs.length - 1].slice(10) === msg) return; // 避免完全相同的日志刷屏
        console.log(`[ZHS-Auto] ${line}`);
        logs.push(line);
        if (logs.length > 30) logs.shift();

        const logBox = document.getElementById('zhs-auto-log-box');
        if (logBox) {
            logBox.innerHTML = logs.map(l => `<div style="margin-bottom:3px;">${l}</div>`).join('');
            logBox.scrollTop = logBox.scrollHeight;
        }
    }

    function updatePanelRunningUI() {
        const pauseBtn = document.getElementById('zhs-btn-pause');
        const statusBadge = document.getElementById('zhs-status-badge');
        const taskEl = document.getElementById('zhs-current-task');
        if (!pauseBtn || !statusBadge) return;

        if (window.__zhs_paused) {
            pauseBtn.innerText = '▶️ 启动脚本';
            pauseBtn.style.background = '#10b981';
            pauseBtn.style.color = '#ffffff';
            statusBadge.innerText = '待机中 (手动启动)';
            statusBadge.style.background = 'rgba(245, 158, 11, 0.2)';
            statusBadge.style.color = '#fbbf24';
            if (taskEl) taskEl.innerText = '⏸️ 常态待机中，请点击下方【启动脚本】开始';
        } else {
            pauseBtn.innerText = '⏸️ 停止脚本';
            pauseBtn.style.background = '#ef4444';
            pauseBtn.style.color = '#ffffff';
            statusBadge.innerText = '运行中 v3.1';
            statusBadge.style.background = 'rgba(52, 211, 153, 0.15)';
            statusBadge.style.color = '#34d399';
            if (taskEl && taskEl.innerText.includes('待机中')) {
                taskEl.innerText = '🚀 已启动，正在检测当前页面任务...';
            }
        }
    }

    function createFloatPanel() {
        if (document.getElementById('zhs-auto-panel')) return;

        let savedPos = { top: '70px', right: '20px', left: 'auto' };
        try {
            const posStr = localStorage.getItem('ZHS_PANEL_POS');
            if (posStr) savedPos = JSON.parse(posStr);
        } catch (e) {}

        const panel = document.createElement('div');
        panel.id = 'zhs-auto-panel';
        panel.style.cssText = `
            position: fixed;
            top: ${savedPos.top};
            left: ${savedPos.left};
            right: ${savedPos.right};
            width: 330px;
            background: rgba(18, 22, 32, 0.96);
            color: #e2e8f0;
            border: 1px solid rgba(56, 189, 248, 0.45);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
            font-size: 12px;
            backdrop-filter: blur(10px);
            overflow: hidden;
            user-select: none;
        `;

        panel.innerHTML = `
            <!-- 顶部可拖拽标题栏 -->
            <div id="zhs-panel-header" style="background: linear-gradient(90deg, #0284c7, #2563eb); padding: 10px 14px; font-weight: bold; font-size: 13px; display: flex; justify-content: space-between; align-items: center; color: #fff; cursor: move;" title="按住此处可自由拖动面板">
                <span>🚀 智慧树 AI 全自动伴学 ✥</span>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span id="zhs-status-badge" style="font-size: 11px; background: rgba(245, 158, 11, 0.2); padding: 2px 8px; border-radius: 99px; color: #fbbf24;">待机中</span>
                    <span id="zhs-btn-minimize" style="cursor:pointer; padding:0 4px; font-size:14px;" title="折叠/展开面板">－</span>
                </div>
            </div>

            <div id="zhs-panel-body" style="padding: 12px 14px;">
                <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #94a3b8;">当前状态:</span>
                    <span id="zhs-current-task" style="color: #38bdf8; font-weight: bold; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">⏸️ 常态待机中，请点击下方启动</span>
                </div>

                <!-- 实时日志窗口 -->
                <div id="zhs-auto-log-box" style="height: 110px; overflow-y: auto; background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px; font-family: Consolas, monospace; font-size: 11px; color: #cbd5e1; margin-bottom: 10px; line-height: 1.4;">
                    <div>系统已就绪（默认待机，点击【启动脚本】开始）...</div>
                </div>

                <!-- 按钮区 -->
                <div style="display: flex; gap: 6px;">
                    <button id="zhs-btn-pause" style="flex: 1.2; padding: 7px 0; background: #10b981; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">▶️ 启动脚本</button>
                    <button id="zhs-btn-next-node" style="flex: 1; padding: 7px 0; background: #8b5cf6; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">⏩ 切下一节</button>
                    <button id="zhs-btn-config" style="flex: 0.9; padding: 7px 0; background: #3b82f6; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;">⚙️ 设置</button>
                </div>

                <!-- 折叠配置表单 (默认隐藏) -->
                <div id="zhs-config-drawer" style="display: none; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.12);">
                    <div style="margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
                        <label style="color: #94a3b8; cursor: pointer;" for="zhs-input-skip">跳过已完成内容/章节:</label>
                        <input id="zhs-input-skip" type="checkbox" ${CONFIG.skipCompleted ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px;">
                    </div>
                    <div style="margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
                        <label style="color: #94a3b8; cursor: pointer;" for="zhs-input-auto-quiz">视频后自动进入章节测试:</label>
                        <input id="zhs-input-auto-quiz" type="checkbox" ${CONFIG.autoAnswer ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px;">
                    </div>
                    <div style="margin-bottom: 6px;">
                        <label style="display:block; color:#94a3b8; margin-bottom:2px;">AI API 接口地址 (留空则使用保底答题):</label>
                        <input id="zhs-input-url" type="text" placeholder="例如: https://api.deepseek.com/v1" value="${CONFIG.aiApiUrl}" style="width:100%; box-sizing:border-box; padding:5px 8px; border-radius:4px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:11px;">
                    </div>
                    <div style="margin-bottom: 6px;">
                        <label style="display:block; color:#94a3b8; margin-bottom:2px;">AI API Key (密钥):</label>
                        <input id="zhs-input-key" type="password" placeholder="sk-..." value="${CONFIG.aiApiKey}" style="width:100%; box-sizing:border-box; padding:5px 8px; border-radius:4px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:11px;">
                    </div>
                    <div style="margin-bottom: 8px;">
                        <label style="display:block; color:#94a3b8; margin-bottom:2px;">AI 模型名称 (Model):</label>
                        <input id="zhs-input-model" type="text" placeholder="例如: deepseek-chat / gpt-4o-mini" value="${CONFIG.aiModel}" style="width:100%; box-sizing:border-box; padding:5px 8px; border-radius:4px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:11px;">
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button id="zhs-btn-save" style="flex: 2; padding: 6px 0; background: #22c55e; color: #fff; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">💾 保存设置</button>
                        <button id="zhs-btn-clear-reset" style="flex: 1; padding: 6px 0; background: #64748b; color: #fff; border: none; border-radius: 5px; cursor: pointer; font-size: 11px;" title="清空已完成测验记录">重置测验记录</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        updatePanelRunningUI();

        // 实现面板自由拖拽与边界保护
        const header = document.getElementById('zhs-panel-header');
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'zhs-btn-minimize') return;
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            panel.style.right = 'auto';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            panel.style.left = newX + 'px';
            panel.style.top = newY + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                localStorage.setItem('ZHS_PANEL_POS', JSON.stringify({
                    top: panel.style.top,
                    left: panel.style.left,
                    right: 'auto'
                }));
            }
        });

        // 折叠/展开按钮
        const minBtn = document.getElementById('zhs-btn-minimize');
        const bodyEl = document.getElementById('zhs-panel-body');
        minBtn.addEventListener('click', () => {
            const isHidden = bodyEl.style.display === 'none';
            bodyEl.style.display = isHidden ? 'block' : 'none';
            minBtn.innerText = isHidden ? '－' : '＋';
        });

        // 绑定启动/停止事件
        const pauseBtn = document.getElementById('zhs-btn-pause');
        pauseBtn.addEventListener('click', () => {
            const willRun = window.__zhs_paused;
            setScriptRunning(willRun);
            addLog(willRun ? '▶️ 脚本已手动启动，开始全自动任务' : '⏸️ 脚本已停止，进入常态待机');
        });

        // 绑定手动切下一节按钮
        document.getElementById('zhs-btn-next-node').addEventListener('click', () => {
            addLog('手动触发：正在切往下一个未完成知识点...');
            isSwitchingNode = false;
            switchToNextKnowledgeNode(true);
        });

        const configBtn = document.getElementById('zhs-btn-config');
        const drawer = document.getElementById('zhs-config-drawer');
        configBtn.addEventListener('click', () => {
            drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('zhs-btn-save').addEventListener('click', () => {
            saveConfig({
                skipCompleted: document.getElementById('zhs-input-skip').checked,
                autoAnswer: document.getElementById('zhs-input-auto-quiz').checked,
                aiApiUrl: document.getElementById('zhs-input-url').value,
                aiApiKey: document.getElementById('zhs-input-key').value,
                aiModel: document.getElementById('zhs-input-model').value
            });
            drawer.style.display = 'none';
        });

        document.getElementById('zhs-btn-clear-reset').addEventListener('click', () => {
            localStorage.removeItem('ZHS_DONE_QUIZZES');
            setRootCookie('ZHS_DONE_QUIZZES', '[]');
            doneResourcesMem.clear();
            sessionStorage.removeItem('ZHS_DONE_RESOURCES');
            addLog('🧹 已重置本机测验与视频防重记录');
        });
    }

    // ==========================================
    // 6. 核心页面逻辑 A：课程学习页 (learnPage)
    // ==========================================
    let isSwitchingNode = false;
    let lastResourceClickTime = 0;

    function handleLearnPage() {
        if (window.__zhs_paused || isSwitchingNode) return;

        const currentNodeId = getCurrentNodeId();
        const cards = Array.from(document.querySelectorAll('.basic-info-video-card-container'));
        const activeCard = cards.find(c => c.classList.contains('active'));

        // 1. 先检查当前视频状态（若视频刚播完但网页未刷新“已完成”，立即标记该卡片已完成并暂停，绝不重复播放！）
        const video = document.querySelector('video');
        if (video) {
            if (!video.muted && CONFIG.muted) {
                video.muted = true;
            }
            if (video.playbackRate !== CONFIG.playbackRate) {
                video.playbackRate = CONFIG.playbackRate;
            }

            // 拦截随堂弹题
            handleInVideoQuiz();

            const isVideoEnded = video.ended || (video.duration > 3 && video.duration - video.currentTime < 1.2);
            if (isVideoEnded || (activeCard && isResourceDone(activeCard))) {
                if (!video.paused) {
                    video.pause();
                }
                if (activeCard && !isResourceDone(activeCard)) {
                    markResourceDone(activeCard);
                    addLog('🎉 当前视频播放完毕，已锁定防重状态！');
                }
                handlePostVideo();
                return;
            }

            // 正常播放守护（仅在当前卡片未完成且视频未结束时恢复播放）
            if (video.paused && !video.ended) {
                video.play().catch(() => {});
            }

            const cur = Math.floor(video.currentTime);
            const total = Math.floor(video.duration);
            const taskEl = document.getElementById('zhs-current-task');
            if (taskEl && total > 0) {
                taskEl.innerText = `🎬 视频学习中 (${cur}s / ${total}s) [${CONFIG.playbackRate}x]`;
            }
            return;
        }

        // 2. 若当前没有 video 标签（例如文档/PPT 或刚进入小节）
        if (cards.length > 0 && CONFIG.skipCompleted) {
            const uncompletedCards = cards.filter(c => !isResourceDone(c));
            if (uncompletedCards.length === 0) {
                // 本小节所有必学资源均已完成
                handlePostVideo();
                return;
            }

            // 如果当前高亮卡片已完成，切换至下一个未完成卡片
            if (activeCard && isResourceDone(activeCard)) {
                const nextCard = uncompletedCards.find(c => c !== activeCard);
                if (nextCard && Date.now() - lastResourceClickTime > 3000) {
                    lastResourceClickTime = Date.now();
                    const cardTitle = nextCard.innerText.replace(/\s+/g, ' ').slice(0, 15);
                    addLog(`切换至本节未完成资源: ${cardTitle}`);
                    nextCard.click();
                    return;
                }
            }
        }

        // 3. PPT / 文档阅读处理
        handleDocumentResource();
    }

    function handleInVideoQuiz() {
        const dialog = document.querySelector('.topic-item, .dialog-test, [class*="dialog-test"]');
        if (dialog && dialog.clientHeight > 0) {
            addLog('检测到随堂弹题，正在自动解答...');
            const opts = dialog.querySelectorAll('.topic-option-item, .answer, [class*="option"]');
            if (opts.length > 0) opts[0].click();
            setTimeout(() => {
                const closeBtn = dialog.querySelector('.btn, .submit-btn, .close-btn, [class*="btn"], .el-button');
                if (closeBtn) closeBtn.click();
            }, 500);
        }
    }

    function handlePostVideo() {
        if (isSwitchingNode) return;
        const now = Date.now();
        if (now - lastResourceClickTime < 3000) return;

        const cards = Array.from(document.querySelectorAll('.basic-info-video-card-container'));
        const activeCard = cards.find(c => c.classList.contains('active'));
        if (activeCard) {
            markResourceDone(activeCard);
        }

        // 寻找除当前卡片以外、且未完成的卡片
        const nextUncompleted = cards.find(c => c !== activeCard && !isResourceDone(c));
        if (nextUncompleted) {
            lastResourceClickTime = now;
            addLog('切换至本节下一资源: ' + nextUncompleted.innerText.replace(/\s+/g, ' ').slice(0, 15));
            nextUncompleted.click();
            return;
        }

        // 本小节所有资源已学完，判断是否需要去答题（防循环刷同一题！）
        const currentNodeId = getCurrentNodeId();
        const actionBtn = document.querySelector('.simplified-mastery__action');
        const actionText = actionBtn ? actionBtn.innerText.trim() : '';

        // 判断该小节测验是否已经做过：
        // 1. 已记录在 ZHS_DONE_QUIZZES 中
        // 2. 或者按钮文字已变成“去提升”（说明“去练习”已完成过一次，已有掌握度得分）
        const quizAlreadyDone = isQuizDone(currentNodeId) || actionText.includes('去提升');

        if (actionBtn && CONFIG.autoAnswer && !quizAlreadyDone) {
            lastResourceClickTime = now;
            markQuizDone(currentNodeId); // 立即标记该节点已进入过测验，彻底杜绝返回后死循环重进！
            addLog(`📝 必学已完成，首次进入本节测验 (${actionText || '去练习'})...`);
            setTimeout(() => actionBtn.click(), 800);
            return;
        }

        if (quizAlreadyDone) {
            addLog('✅ 本节视频与练习均已达成，准备切往下一节...');
        }
        switchToNextKnowledgeNode();
    }

    function handleDocumentResource() {
        const cards = Array.from(document.querySelectorAll('.basic-info-video-card-container'));
        const activeCard = cards.find(c => c.classList.contains('active'));
        if (!activeCard) return;

        const nextDocBtn = document.querySelector('.little-btn.next-page-btn, .pdf-next, [class*="next-page"]');
        if (nextDocBtn && nextDocBtn.clientHeight > 0 && !nextDocBtn.classList.contains('disabled')) {
            nextDocBtn.click();
        } else {
            // 文档已无下一页或无需翻页，标记该文档卡片完成
            markResourceDone(activeCard);
            handlePostVideo();
        }
    }

    // ==========================================
    // 智能切往下一个知识点 (防原地踏步 + 自动展开折叠章节)
    // ==========================================
    function switchToNextKnowledgeNode(forceNext = false) {
        if (isSwitchingNode) return;
        isSwitchingNode = true;

        // 1. 展开所有未展开的折叠章节面板
        const closedHeaders = Array.from(document.querySelectorAll('.el-collapse-item__header:not(.is-active)'));
        for (const h of closedHeaders) {
            h.click();
        }

        setTimeout(() => {
            const sectionItems = Array.from(document.querySelectorAll('.section-item-collapse-info'));
            if (sectionItems.length === 0) {
                addLog('⚠️ 未找到左侧小节目录，稍后重试...');
                isSwitchingNode = false;
                return;
            }

            const activeIdx = sectionItems.findIndex(el => el.classList.contains('active'));
            let targetItem = null;
            let targetIdx = -1;

            // 判断小节是否已完成：必学 X/X (且 X>0)，并且如果开启了自动答题，掌握度不为 0%（除非是手动强制切下一节）
            const isSectionCompleted = (item) => {
                const text = item.innerText.replace(/\s+/g, ' ');
                const match = text.match(/必学\s*(\d+)\/(\d+)/);
                const resourcesDone = match ? (parseInt(match[1], 10) >= parseInt(match[2], 10) && parseInt(match[2], 10) > 0) : text.includes('100%');
                return resourcesDone;
            };

            // 从 activeIdx + 1 往后找第一个未完成小节（若 forceNext 则直接切 activeIdx + 1）
            for (let i = activeIdx + 1; i < sectionItems.length; i++) {
                const item = sectionItems[i];
                if (forceNext || !CONFIG.skipCompleted || !isSectionCompleted(item)) {
                    targetItem = item;
                    targetIdx = i;
                    break;
                }
            }

            // 如果往后看必学都显示完成了，但当前小节刚做完需要往后推进，则优先推进到 activeIdx + 1
            if (!targetItem && activeIdx + 1 < sectionItems.length) {
                targetItem = sectionItems[activeIdx + 1];
                targetIdx = activeIdx + 1;
            }

            if (targetItem) {
                const titleEl = targetItem.querySelector('.section-item-collapse-title') || targetItem;
                const title = titleEl.innerText.trim();
                addLog(`⏩ 跳转至知识点 [${targetIdx + 1}/${sectionItems.length}]: ${title}`);
                const taskEl = document.getElementById('zhs-current-task');
                if (taskEl) taskEl.innerText = `跳转至: ${title}`;

                targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetItem.click();
                titleEl.click();
            } else {
                addLog('🎉 课程目录已到达最后一节！');
                setScriptRunning(false);
            }

            setTimeout(() => {
                isSwitchingNode = false;
            }, 3500);
        }, 700);
    }

    // ==========================================
    // 7. 核心页面逻辑 B：掌握度过渡页 (masteryHistory)
    // ==========================================
    function handleMasteryPage() {
        if (window.__zhs_paused) return;
        const improveBtn = document.querySelector('.improve-btn');
        if (improveBtn) {
            addLog('检测到测评入口，正在进入作业考试...');
            setTimeout(() => improveBtn.click(), 800);
        }
    }

    // ==========================================
    // 8. 核心页面逻辑 C：作业考试答题页 (studentReviewTestOrExam)
    //    严格串行锁 + .checkedIcon 精准检测 + 答题卡查漏补缺 + 防漏题提交
    // ==========================================
    let isAnswering = false;

    async function handleExamPage() {
        if (window.__zhs_paused || isAnswering) return;
        isAnswering = true;

        try {
            // 0. 若页面上已经弹出了交卷确认对话框，优先点击确认按钮
            const activeConfirmBtn = Array.from(document.querySelectorAll('.comfirm.button, .el-message-box__btns .el-button--primary, .el-dialog__footer button, span.comfirm'))
                .find(el => el.offsetParent !== null && ['提交', '确定', '确认提交'].includes(el.innerText.trim()));
            if (activeConfirmBtn) {
                addLog('⚡ 检测到交卷确认弹窗，正在点击确认...');
                activeConfirmBtn.click();
                await sleep(1500);
                return;
            }

            // 1. 检查是否处于已提交的答案解析反馈界面
            if (checkAndScrapeAnswers()) {
                markQuizDone(getCurrentNodeId());
                addLog('📥 已收录官方标准答案，正在返回学习页...');
                await sleep(1500);
                const backBtn = document.querySelector('.back, [class*="back"]');
                if (backBtn) backBtn.click();
                else window.history.back();
                return;
            }

            // 2. 定位当前题目容器与选项列表
            const radioView = document.querySelector('.radio-view, .checkbox-view, [class*="radio-view"]');
            if (!radioView) return;

            const questionBox = radioView.closest('.questionContent') || document;
            const stemEl = questionBox.querySelector('.question-title .preStyle, .preStyle, .stem');
            const stem = stemEl ? stemEl.innerText.trim() : '';
            const typeEl = questionBox.querySelector('.letterSortNum');
            const type = typeEl ? typeEl.innerText.trim() : '单选题';
            const numEl = questionBox.querySelector('.number');
            const qNumText = numEl ? numEl.innerText.trim() : '';

            const taskEl = document.getElementById('zhs-current-task');
            if (taskEl) taskEl.innerText = `✍️ 正在答题 ${qNumText}: ${stem.slice(0, 12)}...`;

            // 3. 精准检查当前题是否已勾选 (智慧树选中态类名为 .checkedIcon)
            let isAnswered = !!radioView.querySelector('.checkedIcon, .checkIcon.active, li.active, li.checked');

            if (!isAnswered && stem) {
                addLog(`📖 正在读题 ${qNumText} [${type}]: ${stem.slice(0, 18)}...`);

                const optionEls = Array.from(radioView.querySelectorAll('li.clearfix, li'));
                const options = optionEls.map((el, i) => {
                    const letterEl = el.querySelector('.letterSort');
                    const textEl = el.querySelector('.stem, .preStyle');
                    const letter = letterEl ? letterEl.innerText.replace(/[^A-Za-z]/g, '').toUpperCase() : String.fromCharCode(65 + i);
                    const text = textEl ? textEl.innerText.trim() : el.innerText.trim();
                    return { element: el, letter, text };
                });

                // 优先查本地题库 -> 其次查 AI -> 保底选 A
                let targetLetters = queryTiku(stem);
                if (targetLetters) {
                    addLog(`⚡ 本地题库命中: [${targetLetters}]`);
                } else {
                    targetLetters = await queryAIAnswer(type, stem, options);
                }

                if (!targetLetters || !/[A-F]/.test(targetLetters)) {
                    targetLetters = 'A';
                    addLog('🛡️ 使用保底策略勾选: [A]');
                }

                // 执行点击（注意：在智慧树 Vue 组件中，直接点击 li.clearfix 即可触发 chooseAnswer，切勿同时点击 li 与子元素以免多选题反选）
                let clickedAny = false;
                for (const opt of options) {
                    if (targetLetters.includes(opt.letter)) {
                        opt.element.click();
                        clickedAny = true;
                        await sleep(250);
                    }
                }
                if (!clickedAny && options.length > 0) {
                    options[0].element.click();
                    await sleep(250);
                }

                // 等待 Vue 渲染 .checkedIcon 并二次校验是否成功勾上
                await sleep(350);
                isAnswered = !!radioView.querySelector('.checkedIcon, .checkIcon.active, li.active, li.checked');
                if (!isAnswered && options.length > 0) {
                    const fallbackTarget = options[0].element.querySelector('.checkIcon') || options[0].element;
                    fallbackTarget.click();
                    await sleep(400);
                }
            }

            // 4. 确认当前题已选中后，决定点击“下一题”还是“查漏/交卷”
            const nextBtn = document.querySelector('.next-topic.next-t, .next-btn');
            const isLastQuestion = !nextBtn || nextBtn.classList.contains('nonext') || nextBtn.style.display === 'none';

            if (!isLastQuestion && nextBtn) {
                addLog(`➡️ 第 ${qNumText || ''} 题已作答，进入下一题...`);
                nextBtn.click();
                // 关键：等待 1200ms 让智慧树发送 saveAnswer 请求并加载完下一题 DOM，绝不提前解锁！
                await sleep(1200);
                return;
            }

            // 5. 已到达最后一题：检查右侧答题卡 (.stu-sheet) 是否还有前面遗漏未答的题 (.no-answer)
            const sheetNodes = Array.from(document.querySelectorAll('.stu-sheet .font-sec-style-node'));
            if (sheetNodes.length > 1) {
                // 除最后一题（当前题尚未触发翻页保存，因此答题卡上可能仍显示 no-answer）外，检查前 N-1 题是否有遗漏
                const missedNode = sheetNodes.slice(0, -1).find(n => n.parentElement && n.parentElement.classList.contains('no-answer'));
                if (missedNode) {
                    const missedNum = missedNode.innerText.trim();
                    addLog(`🔍 发现第 ${missedNum} 题未保存作答，正在跳转补答...`);
                    missedNode.click();
                    await sleep(1200);
                    return;
                }
            }

            // 6. 所有题目均已作答完毕，记录该知识点测验已完成，并点击【提交】
            markQuizDone(getCurrentNodeId());
            const submitBtn = document.querySelector('.reviewDone, .submit-btn, [class*="reviewDone"]');
            if (submitBtn) {
                addLog('🎯 全卷作答完毕，正在点击【提交】...');
                submitBtn.click();

                // 等待 saveAnswer('submits') 完成并弹出确认框
                for (let i = 0; i < 10; i++) {
                    await sleep(500);
                    const confirmBtn = Array.from(document.querySelectorAll('.comfirm.button, .el-message-box__btns .el-button--primary, .el-dialog__footer button, span.comfirm, div.comfirm'))
                        .find(el => el.offsetParent !== null && ['提交', '确定', '确认提交'].includes(el.innerText.trim()));
                    if (confirmBtn) {
                        confirmBtn.click();
                        addLog('✅ 已确认提交试卷！等待跳转结果页...');
                        await sleep(2000);
                        break;
                    }
                }
            }
        } catch (err) {
            console.error('[ZHS-Auto] 答题异常:', err);
        } finally {
            isAnswering = false;
        }
    }

    // 抓取提交后的正确答案反馈（自学习题库）
    function checkAndScrapeAnswers() {
        const answerBoxes = Array.from(document.querySelectorAll('.answerBox, .analysis-box, [class*="answer"], [class*="analysis"]'));
        let scraped = false;

        answerBoxes.forEach(block => {
            const text = block.innerText || '';
            const match = text.match(/(?:正确答案|参考答案)[：:]\s*([A-Za-z]+)/);
            if (match) {
                const parent = block.closest('.questionContent') || block.parentElement;
                const stemEl = parent ? parent.querySelector('.preStyle, .stem, h3, .title') : null;
                const stem = stemEl ? stemEl.innerText.trim() : '';
                if (stem) {
                    saveTikuAnswer(stem, match[1].toUpperCase());
                    scraped = true;
                }
            }
        });
        return scraped;
    }

    // ==========================================
    // 9. 核心页面逻辑 D：结果/单点回顾页 (point)
    // ==========================================
    let isReturningFromPoint = false;
    function handlePointPage() {
        if (window.__zhs_paused || isReturningFromPoint) return;
        isReturningFromPoint = true;

        // 记录该 pointId 测验已完成，防止回到 learnPage 后死循环重进测验！
        const pointId = getCurrentNodeId();
        markQuizDone(pointId);
        checkAndScrapeAnswers();

        addLog('✅ 测验已完成并记录，正在返回学习页切往下一节...');
        setTimeout(() => {
            const parts = location.pathname.split('/');
            if (parts.length >= 7) {
                const courseId = parts[2];
                const nodeId = parts[5];
                const classId = parts[6];
                markQuizDone(nodeId);
                location.href = `https://ai-smart-course-student-pro.zhihuishu.com/learnPage/${courseId}/${nodeId}/${classId}?catalogActiveTab=personal`;
            } else {
                const backBtn = document.querySelector('.backup, .back, [class*="backup"], [class*="back"]');
                if (backBtn) backBtn.click();
                else window.history.back();
            }
        }, 1500);
    }

    // ==========================================
    // 10. 主调度入口
    // ==========================================
    function init() {
        createFloatPanel();
        if (window.__zhs_paused) {
            addLog('⏸️ 脚本处于常态关闭(待机)状态，点击【启动脚本】即可开始');
        } else {
            addLog('🚀 脚本已跨页续航运行中 (v3.1)');
        }

        setInterval(() => {
            if (!window.__zhs_paused) {
                // 刷新跨子域运行心跳
                setRootCookie('ZHS_AUTO_BEAT', String(Date.now()), 3600);
            }

            const url = location.href;
            if (url.includes('/learnPage/')) {
                handleLearnPage();
            } else if (url.includes('/masteryHistory/')) {
                handleMasteryPage();
            } else if (url.includes('studentReviewTestOrExam') || url.includes('studentexamcomh5')) {
                handleExamPage();
            } else if (url.includes('/point/')) {
                handlePointPage();
            }
        }, CONFIG.intervalCheck);
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
