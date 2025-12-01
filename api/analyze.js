export default async function handler(request, response) {
  // CORS設定（念のため）
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
    // データ読み取りの安全化
    let body = request.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return response.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    
    const { productName, imageUrl, apiKey, isTest } = body;

    if (!apiKey) {
      return response.status(400).json({ error: 'API Key Missing' });
    }

    // キーのクリーニング
    const cleanKey = apiKey.trim().replace(/[\r\n\s]/g, '');

    // 指定されたモデル: gemini-2.5-flash
    const model = 'gemini-2.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

    const systemPrompt = isTest 
      ? "Reply with 'OK'."
      : `
      あなたはECサイトのコンプライアンス担当です。
      商品名: "${productName}"
      この商品が「楽天市場の禁止商材（医薬品、偽ブランド、アダルト、金券、生体など）」や「薬機法・景表法違反のリスク」に該当するか判定してください。
      
      リスクレベルを "低", "中", "高" のいずれかで回答し、理由を20文字以内で簡潔に述べてください。
      出力フォーマット(JSON): {"risk_level": "レベル", "is_critical": boolean, "reason": "理由"}
    `;

    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }]
      })
    };

    const geminiRes = await fetch(geminiUrl, fetchOptions);

    if (!geminiRes.ok) {
        const errData = await geminiRes.json().catch(() => ({}));
        console.error('Gemini API Error:', errData);
        
        // エラー詳細をクライアントに返す
        const status = geminiRes.status;
        let message = errData.error?.message || geminiRes.statusText;

        // よくあるエラーの翻訳
        if (status === 404) message = `モデル(${model})が見つかりません`;
        if (status === 400) message = `APIキーが無効かリクエスト不正です`;
        if (status === 429) message = `APIリクエスト制限(Quota)超過`;

        return response.status(status).json({ risk_level: "エラー", reason: message });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        return response.status(500).json({ risk_level: "エラー", reason: "AIからの応答が空です" });
    }

    if (isTest) {
        return response.status(200).json({ status: 'OK', message: 'Connected' });
    }

    // JSON抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { risk_level: "不明", is_critical: false, reason: "解析不能" };

    return response.status(200).json(result);

  } catch (error) {
    console.error("Server Internal Error:", error);
    return response.status(500).json({ risk_level: "エラー", reason: `Server Error: ${error.message}` });
  }
}