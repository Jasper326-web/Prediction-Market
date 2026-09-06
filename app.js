/* ====================================================================
 * 预测市场 · 前端逻辑
 * - 纯 HTML/CSS/JS，无框架
 * - 通过 OpenRouter 调用顶尖 LLM
 * - 支持文字附件（直接读取）与音频附件（base64 多模态传入）
 * ==================================================================== */

(() => {
  "use strict";

  /* ---------- 1. 常量与配置 ---------- */

  // 部署到 Vercel 时用 /api/chat 代理（从美国节点转发，绕开国内网络限制）
  // 本地开发或其他环境直接请求 OpenRouter
  const USE_PROXY = /vercel\.app$|localhost/.test(location.hostname);
  const API_URL = USE_PROXY
    ? "/api/chat"
    : "https://openrouter.ai/api/v1/chat/completions";

  // 可选模型（OpenRouter 上顶尖模型，按能力分组）
  const MODELS = [
    { id: "anthropic/claude-opus-4.1",            name: "Claude Opus 4.1 · 顶尖推理" },
    { id: "anthropic/claude-sonnet-4.5",           name: "Claude Sonnet 4.5 · 综合强" },
    { id: "openai/gpt-5",                          name: "GPT-5 · OpenAI 旗舰" },
    { id: "openai/gpt-4o",                         name: "GPT-4o · 多模态(支持音频)" },
    { id: "google/gemini-2.5-pro",                 name: "Gemini 2.5 Pro · 长上下文多模态" },
    { id: "google/gemini-2.5-flash",               name: "Gemini 2.5 Flash · 快速" },
    { id: "x-ai/grok-4",                           name: "Grok-4 · xAI" },
    { id: "deepseek/deepseek-r1",                  name: "DeepSeek R1 · 深度推理" },
    { id: "qwen/qwen3-235b-a22b",                  name: "Qwen3 235B · 通义" },
    { id: "meta-llama/llama-4-maverick",           name: "Llama 4 Maverick" },
  ];

  // 默认模型
  const DEFAULT_MODEL = "anthropic/claude-opus-4.1";

  // 系统提示词
  const SYS_PREDICT = `你是一位顶尖的宏观经济与跨资产市场分析专家，精通大宗商品、股票、房地产、固收、外汇等多市场的传导逻辑。
你的任务：基于用户提供的【关键词】+【关注市场】+【补充说明】+【附件资料】，输出一份高质量、结构化的【市场预测】深度分析报告。

必须包含：
1. 关键词解读：事件/现象本质、历史规律、强度等级。
2. 传导机制：从关键词到每个所选市场的因果链条与影响路径。
3. 影响方向与程度：对每个勾选市场是利好/利空/中性，短期 vs 中长期分别如何，给方向性结论。
4. 关键变量与不确定性：哪些因素会改变判断方向。
5. 时间维度：发酵期、高峰期、衰减期的可能时间窗。
6. 结论与置信度：明确判断 + 置信度百分比。

要求：逻辑严谨、数据/案例支撑、可直接落地。输出 Markdown，结构清晰，使用标题与列表。语言：中文。`;

  const SYS_OPPORTUNITY = `你是一位顶尖的投资机会挖掘专家，擅长从宏观事件/趋势中识别结构性赚钱机会。
你的任务：基于用户提供的【关键词】+【关注市场】+【补充说明】+【附件资料】，输出一份【机会挖掘】报告。

必须包含：
1. 机会清单：列出具体、可操作的潜在机会（标的方向、做多/做空、逻辑链条）。
2. 每个机会标注：驱动逻辑、时间窗口、潜在空间、风险点、所需前提条件。
3. 按确定性/性价比排序（高→低）。
4. 区分【短期交易性机会】与【中长期布局机会】。
5. 风险提示与对冲思路。

要求：可操作、不空泛，给出具体标的/品类方向。输出 Markdown，结构化。语言：中文。`;

  /* ---------- 2. 状态 ---------- */

  const state = {
    apiKey: localStorage.getItem("pm_api_key") || "",
    model: localStorage.getItem("pm_model") || DEFAULT_MODEL,
    temperature: parseFloat(localStorage.getItem("pm_temp") || "0.3"),
    files: [], // {file, kind: 'text'|'audio', content, name, size}
    loading: false,
    lastResult: "",
  };

  const TEXT_EXT = ["txt", "md", "markdown", "csv", "json", "log", "text"];
  const AUDIO_EXT = ["mp3", "wav", "m4a", "ogg", "webm", "flac", "aac"];

  /* ---------- 3. DOM ---------- */

  const $ = (id) => document.getElementById(id);
  const els = {
    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    apiKey: $("apiKey"),
    modelSelect: $("modelSelect"),
    temperature: $("temperature"),
    tempVal: $("tempVal"),
    saveSettings: $("saveSettings"),
    keyword: $("keyword"),
    marketOptions: $("marketOptions"),
    otherMarket: $("otherMarket"),
    supplement: $("supplement"),
    dropzone: $("dropzone"),
    fileInput: $("fileInput"),
    fileList: $("fileList"),
    predictBtn: $("predictBtn"),
    opportunityBtn: $("opportunityBtn"),
    results: $("results"),
    resultType: $("resultType"),
    resultQuery: $("resultQuery"),
    resultModel: $("resultModel"),
    resultBody: $("resultBody"),
    copyBtn: $("copyBtn"),
    closeResults: $("closeResults"),
    toast: $("toast"),
  };

  /* ---------- 4. 初始化 ---------- */

  function init() {
    // 模型下拉
    MODELS.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      els.modelSelect.appendChild(opt);
    });

    // 回填设置
    els.apiKey.value = state.apiKey;
    els.modelSelect.value = state.model;
    els.temperature.value = state.temperature;
    els.tempVal.textContent = state.temperature;

    bindEvents();
  }

  function bindEvents() {
    // 设置弹窗
    els.settingsBtn.addEventListener("click", openSettings);
    els.saveSettings.addEventListener("click", saveSettings);
    els.settingsModal.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", closeSettings)
    );
    els.temperature.addEventListener("input", (e) => {
      els.tempVal.textContent = e.target.value;
    });

    // 文件
    els.fileInput.addEventListener("change", (e) => handleFiles(e.target.files));
    els.dropzone.addEventListener("dragover", (e) => {
      e.preventDefault(); els.dropzone.classList.add("drag");
    });
    els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("drag"));
    els.dropzone.addEventListener("drop", (e) => {
      e.preventDefault(); els.dropzone.classList.remove("drag");
      handleFiles(e.dataTransfer.files);
    });

    // 按钮
    els.predictBtn.addEventListener("click", () => run("predict"));
    els.opportunityBtn.addEventListener("click", () => run("opportunity"));

    // 结果区
    els.copyBtn.addEventListener("click", copyResult);
    els.closeResults.addEventListener("click", () => {
      els.results.hidden = true; state.lastResult = "";
    });

    // 关键词回车
    els.keyword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run("predict");
    });
  }

  /* ---------- 5. 设置 ---------- */

  function openSettings() { els.settingsModal.hidden = false; }
  function closeSettings() { els.settingsModal.hidden = true; }
  function saveSettings() {
    state.apiKey = els.apiKey.value.trim();
    state.model = els.modelSelect.value;
    state.temperature = parseFloat(els.temperature.value);
    localStorage.setItem("pm_api_key", state.apiKey);
    localStorage.setItem("pm_model", state.model);
    localStorage.setItem("pm_temp", String(state.temperature));
    closeSettings();
    toast("设置已保存", "success");
  }

  /* ---------- 6. 文件处理 ---------- */

  function extOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }

  async function handleFiles(fileList) {
    const arr = Array.from(fileList || []);
    for (const file of arr) {
      const ext = extOf(file.name);
      let kind, content;
      if (TEXT_EXT.includes(ext)) {
        kind = "text";
        content = await file.text();
      } else if (AUDIO_EXT.includes(ext)) {
        kind = "audio";
        content = await fileToBase64(file); // data URL
      } else {
        // 尝试当作文本读取
        try { kind = "text"; content = await file.text(); }
        catch { toast(`不支持的文件类型：${file.name}`, "error"); continue; }
      }
      state.files.push({ file, kind, content, name: file.name, size: file.size });
    }
    renderFileList();
    // 清空 input 以便重复选择同一文件
    els.fileInput.value = "";
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function renderFileList() {
    els.fileList.innerHTML = "";
    state.files.forEach((f, idx) => {
      const item = document.createElement("div");
      item.className = "file-item";
      const tag = f.kind === "audio" ? "音频" : "文本";
      item.innerHTML = `
        <span class="ftype">[${tag}]</span>
        <span class="fname" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <span class="ftype">${formatSize(f.size)}</span>
      `;
      const rm = document.createElement("button");
      rm.className = "remove"; rm.title = "移除"; rm.textContent = "✕";
      rm.addEventListener("click", () => {
        state.files.splice(idx, 1); renderFileList();
      });
      item.appendChild(rm);
      els.fileList.appendChild(item);
    });
  }

  function formatSize(b) {
    if (b < 1024) return b + "B";
    if (b < 1048576) return (b / 1024).toFixed(1) + "KB";
    return (b / 1048576).toFixed(1) + "MB";
  }

  /* ---------- 7. 运行分析 ---------- */

  function gatherInput() {
    const keyword = els.keyword.value.trim();
    if (!keyword) { toast("请输入关键词", "error"); els.keyword.focus(); return null; }

    const markets = Array.from(els.marketOptions.querySelectorAll("input:checked"))
      .map((c) => c.value);
    const other = els.otherMarket.value.trim();
    if (other) markets.push(other);

    if (markets.length === 0) {
      // 允许不勾选，但提示一下仍可继续（关键词为主）
    }

    const supplement = els.supplement.value.trim();
    return { keyword, markets, supplement, files: state.files };
  }

  async function run(mode) {
    if (state.loading) return;
    const data = gatherInput();
    if (!data) return;

    if (!state.apiKey) {
      toast("请先在设置中填写 OpenRouter API Key", "error");
      openSettings();
      return;
    }

    setLoading(true, mode);

    // 构建用户消息
    const textParts = [];
    textParts.push(`【关键词】${data.keyword}`);
    textParts.push(
      `【关注市场】${data.markets.length ? data.markets.join("、") : "未指定（请按关键词自动研判最相关市场）"}`
    );
    if (data.supplement) textParts.push(`【补充说明】${data.supplement}`);

    // 文字附件拼进 prompt
    const textFiles = data.files.filter((f) => f.kind === "text");
    if (textFiles.length) {
      const blocks = textFiles.map((f) =>
        `--- 附件：${f.name} ---\n${f.content}\n--- 附件结束 ---`
      );
      textParts.push(`【附件资料】\n${blocks.join("\n\n")}`);
    }

    // 音频附件以多模态方式追加
    const audioFiles = data.files.filter((f) => f.kind === "audio");
    const userContent = [];
    userContent.push({ type: "text", text: textParts.join("\n\n") });

    for (const af of audioFiles) {
      const m = /^data:audio\/([a-zA-Z0-9]+);base64,(.*)$/.exec(af.content);
      const fmt = m ? m[1] : "mp3";
      const b64 = m ? m[2] : "";
      userContent.push({
        type: "input_audio",
        input_audio: { data: b64, format: fmt === "m4a" ? "mp4" : fmt },
      });
    }
    // 若无音频，使用纯文本 content 以保证兼容性
    const userMessage = audioFiles.length
      ? { role: "user", content: userContent }
      : { role: "user", content: textParts.join("\n\n") };

    const systemPrompt = mode === "predict" ? SYS_PREDICT : SYS_OPPORTUNITY;

    const body = {
      model: state.model,
      temperature: state.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        userMessage,
      ],
    };

    try {
      const headers = { "Content-Type": "application/json" };
      // 直连 OpenRouter 时用 Authorization header
      if (!USE_PROXY) {
        headers.Authorization = `Bearer ${state.apiKey}`;
        headers["HTTP-Referer"] = window.location.origin || "https://localhost";
        headers["X-Title"] = "Prediction Market";
      }
      // 走代理时把 apiKey 放到 body，由服务端转发
      if (USE_PROXY) body.apiKey = state.apiKey;

      const res = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(errText);
          msg = j.error?.message || j.error || msg;
        } catch { msg = errText || msg; }
        throw new Error(msg);
      }

      const json = await res.json();
      const answer = json.choices?.[0]?.message?.content || "（模型未返回内容）";
      showResult(mode, data, answer);
    } catch (err) {
      const msg = String(err && err.message || err);
      let hint = "";
      if (/audio|multimodal|input_audio|not support/i.test(msg)) {
        hint = "\n\n提示：当前模型可能不支持音频输入，请切换到 GPT-4o / Gemini 2.5 Pro 等多模态模型，或将音频转写为文字后上传。";
      } else if (/401|unauthor|api key|no auth/i.test(msg)) {
        hint = "\n\n提示：API Key 无效或未授权，请检查设置。";
      }
      showResult(mode, data, "⚠️ 请求失败：" + msg + hint, true);
    } finally {
      setLoading(false, mode);
    }
  }

  function setLoading(on, mode) {
    state.loading = on;
    els.predictBtn.disabled = on;
    els.opportunityBtn.disabled = on;
    if (on) {
      els.results.hidden = false;
      els.resultType.textContent = mode === "predict" ? "市场预测" : "机会挖掘";
      els.resultType.classList.toggle("opportunity", mode === "opportunity");
      els.resultQuery.textContent = "";
      els.resultModel.textContent = state.model;
      els.resultBody.innerHTML = `
        <div class="loading">
          <div class="spinner"></div>
          <div class="loading-text">正在调用 ${state.model} 进行深度${mode === "predict" ? "预测" : "挖掘"}，请稍候…</div>
        </div>`;
    }
  }

  function showResult(mode, data, answer, isError = false) {
    els.results.hidden = false;
    els.resultType.textContent = mode === "predict" ? "市场预测" : "机会挖掘";
    els.resultType.classList.toggle("opportunity", mode === "opportunity");
    els.resultQuery.textContent = `关键词：${data.keyword}${data.markets.length ? " · " + data.markets.join("、") : ""}`;
    els.resultModel.textContent = state.model;
    state.lastResult = answer;
    els.resultBody.innerHTML = isError
      ? `<div class="md">${escapeHtml(answer).replace(/\n/g, "<br>")}</div>`
      : `<div class="md">${renderMarkdown(answer)}</div>`;
    els.results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function copyResult() {
    if (!state.lastResult) { toast("暂无内容", "error"); return; }
    try {
      await navigator.clipboard.writeText(state.lastResult);
      toast("已复制到剪贴板", "success");
    } catch {
      toast("复制失败", "error");
    }
  }

  /* ---------- 8. 轻量 Markdown 渲染 ---------- */

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderMarkdown(md) {
    // 先转义，再做块级处理
    let src = md.replace(/\r\n/g, "\n");
    const lines = src.split("\n");
    const out = [];
    let i = 0;
    let inUl = false, inOl = false, inCode = false, codeBuf = [];

    function closeLists() {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (inOl) { out.push("</ol>"); inOl = false; }
    }

    while (i < lines.length) {
      let line = lines[i];

      // 代码块
      if (/^```/.test(line.trim())) {
        if (!inCode) { closeLists(); inCode = true; codeBuf = []; }
        else { out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`); inCode = false; }
        i++; continue;
      }
      if (inCode) { codeBuf.push(line); i++; continue; }

      // 标题
      let m = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (m) {
        closeLists();
        const lvl = m[1].length;
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
        i++; continue;
      }

      // 分割线
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        closeLists(); out.push("<hr>"); i++; continue;
      }

      // 引用
      if (/^>\s?/.test(line.trim())) {
        closeLists();
        out.push(`<blockquote>${inline(line.trim().replace(/^>\s?/, ""))}</blockquote>`);
        i++; continue;
      }

      // 有序列表
      m = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (m) {
        if (inOl && !inUl) { /* continue */ }
        else { closeLists(); inOl = true; out.push("<ol>"); }
        out.push(`<li>${inline(m[1])}</li>`);
        i++; continue;
      }
      // 无序列表
      m = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (m) {
        if (inUl && !inOl) { /* continue */ }
        else { closeLists(); inUl = true; out.push("<ul>"); }
        out.push(`<li>${inline(m[1])}</li>`);
        i++; continue;
      }

      // 空行
      if (line.trim() === "") { closeLists(); i++; continue; }

      // 普通段落
      closeLists();
      out.push(`<p>${inline(line)}</p>`);
      i++;
    }
    if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
    closeLists();
    return out.join("\n");
  }

  function inline(s) {
    let t = escapeHtml(s);
    // 行内代码
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    // 粗体 **xx**
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // 斜体 *xx* （避免与粗体冲突，简单处理）
    t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    // 链接 [text](url)
    t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }

  /* ---------- 9. Toast ---------- */

  let toastTimer;
  function toast(msg, type = "") {
    els.toast.textContent = msg;
    els.toast.className = "toast" + (type ? " " + type : "");
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  /* ---------- 启动 ---------- */
  init();
})();
