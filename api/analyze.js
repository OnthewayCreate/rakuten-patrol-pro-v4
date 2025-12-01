export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const { productName, imageUrl, apiKey } = request.body;

  if (!apiKey) {
    return response.status(400).json({ error: 'API Key Missing' });
  }

  const prompt = `
    あなたはECサイトのコンプライアンス担当です。
    商品名: "${productName}"
    この商品が「楽天市場の禁止商材（医薬品、偽ブランド、アダルト、金券、生体など）」や「薬機法・景表法違反のリスク」に該当するか判定してください。
    
    リスクレベルを "低", "中", "高" のいずれかで回答し、理由を20文字以内で簡潔に述べてください。
    出力フォーマット(JSON): {"risk_level": "レベル", "is_critical": boolean, "reason": "理由"}
  `;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || 'Gemini API Error');
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error('No response from AI');

    // JSON部分だけ抽出してパース
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : { risk_level: '不明', is_critical: false, reason: '解析不能' };

    return response.status(200).json(result);
  } catch (error) {
    return response
      .status(500)
      .json({ risk_level: 'エラー', reason: error.message });
  }
}
