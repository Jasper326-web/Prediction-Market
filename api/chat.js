// Vercel Serverless Function: POST /api/chat
// 转发到 OpenRouter API，避免浏览器直连的网络问题
export default async function handler(req, res) {
  // CORS 预检（虽然 OpenRouter 支持 CORS，但保险起见）
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

    // 优先用环境变量，否则用前端传来的
    const envKey = process.env.OPENROUTER_API_KEY;
    const apiKey = (envKey && envKey.trim()) || (body.apiKey && body.apiKey.trim());

    if (!apiKey) {
      return res.status(401).json({ error: "No API key provided" });
    }

    // 从 body 里移除 apiKey，避免泄露到 OpenRouter
    const forwarded = { ...body };
    delete forwarded.apiKey;

    // 先 ping 一下 OpenRouter /models 验证 key 是否有效
    const verifyRes = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const verifyStatus = verifyRes.status;

    if (verifyStatus !== 200) {
      const verifyText = await verifyRes.text();
      return res.status(502).json({
        error: "Proxy: OpenRouter key verification failed",
        key_preview: apiKey.slice(0, 12) + "..." + apiKey.slice(-4),
        env_key_present: !!(envKey && envKey.trim()),
        verify_status: verifyStatus,
        verify_body: verifyText.slice(0, 300),
      });
    }

    // Key 验证通过，转发 chat 请求
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
