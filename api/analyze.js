export default async function handler(request, response) {
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
    const model = 'gemini-2.5-flash'; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

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

    // --- 一流弁理士による厳格かつ具体的な判定プロンプト ---
    const systemPrompt = `
    あなたは知的財産権法（商標法、意匠法、著作権法、不正競争防止法）およびECコンプライアンスに精通した、日本トップクラスの弁理士です。
    提供された「商品画像」と「商品名」を法的・客観的根拠に基づいて監査し、以下の4段階で厳格に判定してください。

    【判定基準 (Severity Levels)】

    1. **[重大] (Critical)**: 安全性・公序良俗に関わる絶対禁止商材
       - **対象**: 食品、飲料、サプリメント、医薬品、コンタクトレンズ。
       - **対象**: 化粧品、クリーム、美容液、ローションなど「人体に塗布・接触するもの」全て。
       - **対象**: アダルトグッズ、武器、犯罪を助長するもの。
       - **判定**: これらに該当する場合、権利侵害の有無に関わらず即座に「重大」と判定すること。

    2. **[高] (High)**: 明確な権利侵害（デッドコピー・偽ブランド）
       - **要件**: 画像や名称から、**侵害している「具体的なブランド名」や「キャラクター名」を特定できる場合**に限る。
       - **対象**: ルイ・ヴィトン、シャネル、ナイキ、ディズニー、アニメキャラ等のロゴやデザインの無断使用。
       - **対象**: 「スーパーコピー」「N級品」等の表記。
       - **注意**: 具体的なブランド名を挙げられない場合は「高」にしないこと。

    3. **[中] (Medium)**: 権利侵害の疑い・グレーゾーン
       - **対象**: 「〇〇風」「〇〇タイプ」「〇〇系」と謳い、特定ブランドの顧客吸引力に便乗している商品。
       - **対象**: 特定のブランド名は出していないが、デザインが有名商品に酷似しており、意匠権侵害の懸念が残るもの。
       - **扱い**: 気にするほどではないかもしれないが、一応監視すべきもの。

    4. **[低] (Low)**: 問題なし
       - **対象**: 上記に該当しない一般的な雑貨、家電、衣類、家具など。
       - **対象**: 一般的な形状（チェック柄、ボーダー、普通のトートバッグの形など）であり、特定の権利を侵害していないもの。
       - **注意**: 権利侵害の確証がないものは、むやみに疑わず「低」と判定すること。冤罪は避けること。

    【出力要件】
    - 出力は必ず以下のJSON形式のみ。Markdown装飾不要。
    - risk_level: "重大", "高", "中", "低" のいずれか。
    - reason: **具体的かつ論理的に記述すること。**
      - NG例：「権利侵害の疑いがあります」
      - OK例：「エルメスの『バーキン』の形状における立体商標権を侵害する可能性があります」
      - OK例：「食品衛生法および薬機法関連のため、ECでの無許可販売は禁止されています」
      - OK例：「一般的なデザインであり、特定の知的財産権を侵害する要素は見当たりません」

    JSONフォーマット:
    {"risk_level": "...", "reason": "..."}
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
            parts.push({ text: "（画像取得不可。商品名のみで判定）" });
        }
    }

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });

    if (!geminiRes.ok) {
        const errData = await geminiRes.json().catch(() => ({}));
        // フォールバック (1.5-flash)
        if (geminiRes.status === 404) {
             const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${cleanKey}`;
             const fallbackRes = await fetch(fallbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts }] })
             });
             if (fallbackRes.ok) {
                 const fbData = await fallbackRes.json();
                 const fbText = fbData.candidates?.[0]?.content?.parts?.[0]?.text;
                 const fbJsonMatch = fbText.match(/\{[\s\S]*\}/);
                 const fbResult = fbJsonMatch ? JSON.parse(fbJsonMatch[0]) : { risk_level: "不明", reason: "解析不能" };
                 return response.status(200).json(fbResult);
             }
        }
        return response.status(geminiRes.status).json({ risk_level: "エラー", reason: errData.error?.message || geminiRes.statusText });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        return response.status(500).json({ risk_level: "エラー", reason: "AI応答なし" });
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let result = jsonMatch ? JSON.parse(jsonMatch[0]) : { risk_level: "不明", reason: "フォーマットエラー" };

    // クリティカルフラグの自動付与（アプリ側の互換性のため）
    if (result.risk_level === '重大') {
        result.is_critical = true;
    } else {
        result.is_critical = false;
    }

    return response.status(200).json(result);

  } catch (error) {
    console.error("Server Error:", error);
    return response.status(500).json({ risk_level: "エラー", reason: error.message });
  }
}