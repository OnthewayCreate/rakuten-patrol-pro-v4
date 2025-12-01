export default async function handler(request, response) {
  const { searchParams } = new URL(request.url, `http://${request.headers.host}`);
  const shopUrl = searchParams.get('shopUrl');
  const appId = searchParams.get('appId');
  const page = searchParams.get('page') || 1;

  if (!appId) {
    return response.status(400).json({ error: 'App ID Missing' });
  }

  const endpoint = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706';
  
  // URLからショップコードを抽出（簡易実装）
  let shopCode = shopUrl;
  try {
    if (shopUrl && shopUrl.includes('rakuten.co.jp')) {
        const urlObj = new URL(shopUrl);
        const parts = urlObj.pathname.split('/').filter(p => p);
        // gold/shopCode や shopCode/ のパターンに対応
        shopCode = parts.find(p => p !== 'gold') || shopCode;
    }
  } catch (e) {
    // URLでない場合はそのままコードとして扱う
  }

  try {
    const url = new URL(endpoint);
    url.searchParams.append('applicationId', appId);
    url.searchParams.append('shopCode', shopCode);
    url.searchParams.append('page', page);
    url.searchParams.append('hits', 30);

    const res = await fetch(url.toString());
    
    if (!res.ok) {
        const errData = await res.json();
        return response.status(res.status).json(errData);
    }

    const data = await res.json();
    
    const products = data.Items.map(item => ({
      name: item.Item.itemName,
      imageUrl: item.Item.mediumImageUrls?.[0]?.imageUrl || '',
      itemUrl: item.Item.itemUrl,
      price: item.Item.itemPrice
    }));

    // 商品総数(count)も含めて返す
    return response.status(200).json({ 
        products, 
        count: data.count || 0,
        pageCount: data.pageCount || 1 
    });

  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}