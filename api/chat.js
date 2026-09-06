// Vercel Serverless Function: POST /api/chat
// 转发到 OpenRouter API，支持流式和非流式两种模式
export default async function handler(req, res) {
  // CORS 预检
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!body.model || !body.messages) {
      return res.status(400).json({ error: "Missing model or messages" });
    }

    const envKey = process.env.OPENROUTER_API_KEY;
    const apiKey = (envKey && envKey.trim()) || (body.apiKey && body.apiKey.trim());

    if (!apiKey) {
      return res.status(401).json({ error: "No API key provided" });
    }

    // 从 body 移除 apiKey
    const forwarded = { ...body };
    delete forwarded.apiKey;

    const isStream = forwarded.stream === true;

    const openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://prediction-market-iota-one.vercel.app",
        "X-Title": "Prediction Market",
      },
      body: JSON.stringify(forwarded),
    });

    // 处理错误（提前返回）
    if (!openrouterRes.ok) {
      const data = await openrouterRes.json().catch(() => ({}));
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(openrouterRes.status).json(data.error || { error: "OpenRouter error" });
    }

    // 流式：直接 pipe SSE 响应
    if (isStream && openrouterRes.body) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      // 禁用 Vercel 的 buffer（关键！否则会缓冲整个响应再发送）
      res.setHeader("X-Accel-Buffering", "no");

      const reader = openrouterRes.body.getReader();
      const writer = res;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
        }
        writer.end();
      } catch (pipeErr) {
        try { writer.end(); } catch { /* ignore */ }
      }
      return;
    }

    // 非流式：等待完整 JSON
    const data = await openrouterRes.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(openrouterRes.status).json(data);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({
      error: "Proxy error: " + (err && err.message ? err.message : String(err)),
    });
  }
}
