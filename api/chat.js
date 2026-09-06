// Vercel Serverless Function: POST /api/chat
// 转发到 OpenRouter API，避免浏览器直连的网络问题
export default async function handler(req, res) {
  // 仅允许 POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 验证必要参数
    if (!body.model || !body.messages) {
      return res.status(400).json({ error: "Missing model or messages" });
    }

    // 优先使用环境变量中的 API Key（Vercel 安全），否则使用前端传来的
    const apiKey = process.env.OPENROUTER_API_KEY || body.apiKey;
    if (!apiKey) {
      return res.status(401).json({
        error: "No API key. Set OPENROUTER_API_KEY env var in Vercel, or send apiKey from frontend.",
      });
    }

    // 从 body 中移除 apiKey 避免泄露到 OpenRouter
    const { apiKey: _removed, ...cleanBody } = body;

    // 转发请求到 OpenRouter
    const openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://prediction-market-iota-one.vercel.app",
        "X-Title": "Prediction Market",
      },
      body: JSON.stringify(cleanBody),
    });

    const data = await openrouterRes.json();
    return res.status(openrouterRes.status).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Proxy error: " + (err && err.message ? err.message : String(err)),
    });
  }
}
