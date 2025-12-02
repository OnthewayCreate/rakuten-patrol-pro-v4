export default async function handler(request, response) {
  // CORS設定
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let body = request.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return response.status(400).json({ error: 'Invalid JSON' }); }
    }
    
    const { productName, imageUrl, apiKey, isTest } = body;

    if (!apiKey) {
      return response.status(400).json({ error: 'API Key Missing' });
    }

    const cleanKey = apiKey.trim().replace(/[\r\n\s]/g, '');
    
    // 指定モデル: gemini-2.5-flash
    const model = 'gemini-2.5-flash'; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

    // テスト接続用
    if (isTest) {
        const testRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
        });
        if (testRes.ok) return response.status(200).json({ status: 'OK', message: 'Connected' });
        const err = await testRes.json();
        return response.status(testRes.status).json({ status: 'ERR', message: err.error?.message || testRes.statusText });
    }

    // 弁理士プロンプト
    const systemPrompt = `
    あなたは知的財産権法（商標法、意匠法、著作権法、不正競争防止法）に精通した、ECサイト監査専門の一流弁理士です。
    提供された「商品画像」と「商品名」を法的観点から厳格に監査し、権利侵害リスクおよび禁止商材を判定してください。

    【監査基準（以下のいずれかに該当する場合は「高リスク」と判定）】
    1. **知的財産権の侵害**:
       - **商標権**: 有名ブランドのロゴ、名称、デザインの無断使用。または「〇〇風」「〇〇タイプ」「〇〇系」等としてブランドの顧客誘引力にただ乗りする商品。
       - **意匠権・形態模倣**: 人気商品の形状やデザインをデッドコピーした模倣品。
       - **著作権**: アニメキャラクター、芸能人の写真、他社の公式商品画像の無断転載。
       - **不正競争**: 著名な商品等表示の冒用、誤認混同を招く表示。

    2. **安全性・コンプライアンス（全面禁止）**:
       - **人体への摂取・塗布**: 食品、飲料、サプリメント、医薬品、化粧品、クリーム、美容液、コンタクトレンズなど、「口に入れるもの」「肌に塗るもの」は全て安全性の観点からNGとする。
       - **公序良俗**: アダルトグッズ、不快感を与える商品。

    【判定ロジック】
    - 画像と商品名の両方を照合し、少しでも「本物ではない（模倣品）」「権利関係がクリアでない」疑いがある場合は、厳しくリスクありと判断すること。
    - ノーブランド品であっても、デザインが有名商品に酷似している場合はデッドコピーとして指摘すること。

    【出力形式】
    以下のJSONフォーマットのみで出力してください。Markdown装飾は不要。
    {"risk_level": "重大" | "高" | "中" | "低", "is_critical": boolean, "reason": "法的根拠に基づく簡潔な指摘（例：商標権侵害の疑い、意匠のデッドコピー、食品のため禁止）"}
    `;

    const parts = [{ text: systemPrompt }];
    parts.push({ text: `商品名: ${productName}` });

    if (imageUrl) {
        try {
            const imageRes = await fetch(imageUrl);
            if (imageRes.ok) {
                const arrayBuffer = await imageRes.arrayBuffer();
                const base64Image = Buffer.from(arrayBuffer).toString('base64');
                parts.push({
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: base64Image
                    }
                });
            }
        } catch (imgError) {
            parts.push({ text: "（画像取得失敗。商品名のみで厳格に判定してください）" });
        }
    }

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });

    if (!geminiRes.ok) {
        const errData = await geminiRes.json().catch(() => ({}));
        const message = errData.error?.message || geminiRes.statusText;
        return response.status(geminiRes.status).json({ risk_level: "エラー", reason: message });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        return response.status(500).json({ risk_level: "エラー", reason: "AI応答なし" });
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { risk_level: "不明", is_critical: false, reason: "解析エラー" };

    return response.status(200).json(result);

  } catch (error) {
    console.error("Server Error:", error);
    return response.status(500).json({ risk_level: "エラー", reason: error.message });
  }
}