// Vercel Serverless Function: POST /api/chat
// 转发到 OpenRouter API，避免浏览器直连的网络问题
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

    // 转发到 OpenRouter
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
