export default async function handler(request, response) {
  // CORSヘッダーの追加（念の為）
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
    // ボディのパース（環境によって文字列で来ることがあるため安全策）
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const { productName, imageUrl, isTest } = body;
    let { apiKey } = body;

    // APIキーの厳密なクリーニング（空白、改行、制御文字を削除）
    if (!apiKey) {
      return response.status(400).json({ error: 'API Key Missing' });
    }
    apiKey = apiKey.trim().replace(/[\r\n\s]/g, '');

    // 接続テスト用プロンプト
    const systemPrompt = isTest 
      ? "Reply with 'OK'."
      : `
      あなたはECサイトのコンプライアンス担当です。
      商品名: "${productName}"
      この商品が「楽天市場の禁止商材（医薬品、偽ブランド、アダルト、金券、生体など）」や「薬機法・景表法違反のリスク」に該当するか判定してください。
      
      リスクレベルを "低", "中", "高" のいずれかで回答し、理由を20文字以内で簡潔に述べてください。
      出力フォーマット(JSON): {"risk_level": "レベル", "is_critical": boolean, "reason": "理由"}
    `;

    // モデルは安定版の gemini-1.5-flash を使用
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }]
      })
    });

    if (!geminiRes.ok) {
        const err = await geminiRes.json();
        // Googleからの生のエラー内容をログに出力し、クライアントに返す
        const errorMessage = err.error?.message || `Gemini API Error: ${geminiRes.status}`;
        // ステータスコードをそのまま転送（400ならキー無効、等）
        return response.status(geminiRes.status).json({ risk_level: "エラー", reason: errorMessage });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) throw new Error('No response content from AI');

    // テストモードなら成功を返す
    if (isTest) {
        return response.status(200).json({ status: 'OK', message: 'Connected' });
    }

    // JSON抽出
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { risk_level: "不明", is_critical: false, reason: "解析不能" };

    return response.status(200).json(result);

  } catch (error) {
    // 予期せぬサーバーエラー
    console.error("Server Error:", error);
    return response.status(500).json({ risk_level: "エラー", reason: `System Error: ${error.message}` });
  }
}