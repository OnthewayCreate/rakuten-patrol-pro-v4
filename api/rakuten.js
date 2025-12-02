export default async function handler(request, response) {
  const { searchParams } = new URL(request.url, `http://${request.headers.host}`);
  const shopUrl = searchParams.get('shopUrl');
  const appId = searchParams.get('appId');
  const page = searchParams.get('page') || 1;

  if (!appId) {
    return response.status(400).json({ error: 'App ID Missing' });
  }

  const endpoint = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706';
  
  // URLからショップコードを抽出
  let shopCode = shopUrl;
  try {
    if (shopUrl && shopUrl.includes('rakuten.co.jp')) {
        const urlObj = new URL(shopUrl);
        const parts = urlObj.pathname.split('/').filter(p => p);
        // "gold"ディレクトリなどを除外し、ショップコードを特定
        shopCode = parts.find(p => p !== 'gold') || shopCode;
    }
  } catch (e) {
    // URL解析エラー時はそのままコードとして扱う
  }

  try {
    const url = new URL(endpoint);
    url.searchParams.append('applicationId', appId);
    url.searchParams.append('shopCode', shopCode);
    url.searchParams.append('page', page);
    url.searchParams.append('hits', 30);
    // 画像がある商品を優先、在庫ありなどを指定することも可能だが今回は標準検索
    
    const res = await fetch(url.toString());
    
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return response.status(res.status).json(errData);
    }

    const data = await res.json();
    
    if (!data.Items || !Array.isArray(data.Items)) {
        return response.status(200).json({ products: [], count: 0, pageCount: 0 });
    }

    // データ構造をアプリの仕様（productName, imageUrl）に統一して変換
    const products = data.Items.map(wrapper => {
      const item = wrapper.Item;
      // 画像URLの取得（サイズ違いや欠損に対応）
      let imageUrl = '';
      if (item.mediumImageUrls && item.mediumImageUrls.length > 0) {
          imageUrl = item.mediumImageUrls[0].imageUrl;
      } else if (item.smallImageUrls && item.smallImageUrls.length > 0) {
          imageUrl = item.smallImageUrls[0].imageUrl;
      }

      return {
        productName: item.itemName, // ここで確実に商品名を取得
        imageUrl: imageUrl,
        itemUrl: item.itemUrl,
        price: item.itemPrice,
        itemCode: item.itemCode
      };
    });

    return response.status(200).json({ 
        products, 
        count: data.count || 0,
        pageCount: data.pageCount || 1 
    });

  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}