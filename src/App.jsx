import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ShoppingBag, CheckCircle, Loader2, ShieldAlert, Trash2, Zap, FolderOpen, 
  Lock, LogOut, History, Settings, Search, ExternalLink, Siren, User, X, 
  LayoutDashboard, ChevronRight, Calendar, Folder, FileSearch, ChevronDown, 
  ArrowLeft, Store, Info, PlayCircle, Terminal, Activity, Cloud, ImageIcon, 
  Bot, List, Power, Moon, Clock, RefreshCw, AlertTriangle, Bug, Timer, Filter,
  Check, Wifi, WifiOff
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, 
  serverTimestamp, where, getDocs, deleteDoc, doc, updateDoc, getDoc 
} from 'firebase/firestore';

/**
 * ============================================================================
 * Rakuten Patrol Pro - High Performance & Robust Version
 * ============================================================================
 */

const APP_CONFIG = {
  FIXED_PASSWORD: 'admin', 
  API_TIMEOUT: 90000, 
  RETRY_LIMIT: 5,     
  VERSION: '16.3.0-Turbo'
};

// NGカテゴリ・キーワード定義
const RESTRICTED_KEYWORDS = [
  '食品', '飲料', 'お菓子', 'スイーツ', '肉', '魚', '米', 'サプリ', '酵素', 'ダイエット',
  '化粧品', 'コスメ', '美容液', 'ローション', 'クリーム', 'スキンケア', 'メイク',
  '医薬品', '薬', 'コンタクト', 'レンズ', '治療', 'メディカル',
  'アカウント', 'コード', '電子マネー', 'チケット'
];

const parseFirebaseConfig = (input) => {
  if (!input) return null;
  try { return JSON.parse(input); } catch (e) {
    try {
      let jsonStr = input.replace(/^(const|var|let)\s+\w+\s*=\s*/, '').replace(/;\s*$/, '').replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"');
      return JSON.parse(jsonStr);
    } catch (e2) { return null; }
  }
};

const checkRestrictedCategory = (productName) => {
  if (!productName) return null;
  const foundKey = RESTRICTED_KEYWORDS.find(key => productName.includes(key));
  return foundKey ? `【NG商材】"${foundKey}" 関連` : null;
};

// --- API Wrapper (Load Balanced) ---
async function analyzeItemRisk(itemData, apiKeys, retryCount = 0) {
  const restrictedReason = checkRestrictedCategory(itemData.productName);
  
  // ロードバランシング: 初回からランダムにキーを選択し、リトライ時はシフトする
  // これにより、5つのキーがある場合、最初から負荷が1/5に分散される
  const keyIndex = (Math.floor(Math.random() * apiKeys.length) + retryCount) % apiKeys.length;
  const currentKey = apiKeys.length > 0 ? apiKeys[keyIndex] : '';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APP_CONFIG.API_TIMEOUT);

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName: itemData.productName, imageUrl: itemData.imageUrl, apiKey: currentKey }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.status === 429 || res.status >= 500) {
      if (retryCount < APP_CONFIG.RETRY_LIMIT) {
        // エクスポネンシャルバックオフ + ランダムジッター
        const waitTime = Math.pow(2, retryCount) * 1000 + (Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // 再帰呼び出し（次は別のキーが選ばれる可能性が高い）
        return analyzeItemRisk(itemData, apiKeys, retryCount + 1);
      } else { 
        throw new Error("API混雑 (全キー混雑)"); 
      }
    }
    
    if (!res.ok) throw new Error(`API:${res.status}`);
    const aiResult = await res.json();

    if (restrictedReason) {
      return { ...aiResult, risk_level: '高', is_critical: true, reason: `${restrictedReason} (AI: ${aiResult.reason})` };
    }
    return aiResult;
  } catch (error) {
    if (restrictedReason) return { risk_level: '高', is_critical: true, reason: `${restrictedReason} (Error)` };
    return { risk_level: "エラー", reason: error.message };
  }
}

// キーの健全性チェック関数
async function checkApiKeyHealth(apiKey) {
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10000); // 10秒タイムアウト
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, isTest: true }), // テストモード
            signal: controller.signal
        });
        if (res.ok) return { ok: true, status: 200 };
        return { ok: false, status: res.status };
    } catch (e) {
        return { ok: false, status: 'Error' };
    }
}

const formatTime = (seconds) => {
  if (!seconds || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}分${s}秒`;
};

// --- Components ---
const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
    {toasts.map((t) => (
      <div key={t.id} className={`pointer-events-auto min-w-[320px] p-4 rounded-xl shadow-2xl text-white flex justify-between items-center animate-in slide-in-from-right fade-in duration-300 ${t.type === 'error' ? 'bg-red-600/95' : t.type === 'success' ? 'bg-emerald-600/95' : 'bg-slate-800/95'}`}>
        <span className="text-sm font-medium">{t.message}</span>
        <button onClick={() => removeToast(t.id)}><X className="w-4 h-4" /></button>
      </div>
    ))}
  </div>
);

const RiskBadge = ({ item }) => {
  const { risk, isCritical, is_critical, reason } = item;
  if (reason && reason.includes("【NG商材】")) return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-slate-800 text-white border border-slate-600 gap-1 items-center whitespace-nowrap"><Bug className="w-3 h-3"/> 禁止商材</span>;
  if (isCritical || is_critical) return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 gap-1 items-center whitespace-nowrap"><Siren className="w-3 h-3"/> 重大</span>;
  if (risk === '高' || risk === 'High') return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">高</span>;
  if (risk === '中' || risk === 'Medium') return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">中</span>;
  if (risk === 'エラー') return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">エラー</span>;
  return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">低</span>;
};

const StatCard = ({ title, value, icon: Icon, color, subtext }) => (
  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 transition-transform hover:scale-[1.02]">
    <div className={`p-3 rounded-lg ${color} bg-opacity-10`}><Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} /></div>
    <div><p className="text-xs text-slate-400 font-bold uppercase mb-0.5">{title}</p><p className="text-2xl font-bold text-slate-800">{value}</p>{subtext && <p className="text-[10px] text-slate-400">{subtext}</p>}</div>
  </div>
);

const NavButton = ({ icon: Icon, label, id, active, onClick }) => (
  <button onClick={() => onClick(id)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${active === id ? 'bg-slate-800 text-white shadow-md translate-x-1' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
    <Icon className={`w-5 h-5 ${active === id ? 'text-blue-400' : 'text-slate-400'}`} />{label}
  </button>
);

const LoginView = ({ onLogin }) => {
  const [p, setP] = useState('');
  const [l, setL] = useState(false);
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full border border-slate-100 text-center animate-in zoom-in-95 duration-300">
        <div className="mb-8"><div className="inline-flex p-4 bg-slate-800 rounded-xl mb-4 shadow-lg"><Bot className="w-8 h-8 text-white"/></div><h1 className="text-xl font-bold text-slate-800">Rakuten Patrol <span className="text-blue-600">Pro</span></h1></div>
        <form onSubmit={(e)=>{e.preventDefault(); setL(true); setTimeout(() => onLogin(p).finally(()=>setL(false)), 800);}} className="space-y-4">
          <div className="text-left">
            <label className="text-[10px] font-bold text-slate-400 ml-1">ACCESS KEY</label>
            <input type="password" value={p} onChange={e=>setP(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" placeholder="パスワードを入力" required />
          </div>
          <button disabled={l} className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-lg shadow-blue-200">{l ? <Loader2 className="w-5 h-5 animate-spin mx-auto"/> : "ログイン"}</button>
        </form>
      </div>
    </div>
  );
};

const ResultTable = ({ items, title, onBack }) => {
  const [showAll, setShowAll] = useState(false);
  const displayItems = useMemo(() => {
    if (showAll) return items;
    return items.filter(i => i.risk !== '低' && i.risk !== 'Low');
  }, [items, showAll]);

  const dl = () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let c = "Name,Risk,Reason,URL\n" + items.map(r=>`"${(r.productName||'').replace(/"/g,'""')}",${r.risk},"${(r.reason||'').replace(/"/g,'""')}",${r.itemUrl}`).join('\n');
    const u = URL.createObjectURL(new Blob([bom, c], {type:"text/csv"}));
    const a = document.createElement("a"); a.href=u; a.download="report.csv"; a.click();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex justify-between items-center p-4 pb-0">
        <div className="flex gap-3 items-center">{onBack&&<button onClick={onBack} className="p-2 bg-white border rounded-lg shadow-sm hover:bg-slate-50"><ArrowLeft className="w-4 h-4"/></button>}<h2 className="font-bold text-slate-800 text-lg">{title}</h2></div>
        <div className="flex gap-2">
            <button onClick={() => setShowAll(!showAll)} className={`px-4 py-2 border rounded-lg text-sm font-bold shadow-sm flex items-center gap-2 transition-all ${showAll ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>
                <Filter className="w-4 h-4"/> {showAll ? '全件表示中' : 'リスク検知のみ表示'}
            </button>
            <button onClick={dl} className="px-4 py-2 bg-white border rounded-lg text-sm font-bold text-slate-600 shadow-sm flex gap-2 hover:bg-slate-50 items-center"><ArrowLeft className="w-4 h-4 rotate-[-90deg]"/> CSV</button>
        </div>
      </div>
      
      <div className="bg-white border-t border-slate-100 flex-1 overflow-y-auto p-0">
        {displayItems.length === 0 && !showAll && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <CheckCircle className="w-12 h-12 mb-2 text-emerald-200"/>
                <p>リスク商品は見つかりませんでした</p>
                <button onClick={()=>setShowAll(true)} className="mt-4 text-xs text-blue-500 underline">すべての商品を見る</button>
            </div>
        )}
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                  <th className="p-3 w-16 text-xs font-bold text-slate-500 uppercase text-center">リスク</th>
                  <th className="p-3 w-20 text-xs font-bold text-slate-500 uppercase text-center">画像</th>
                  <th className="p-3 w-1/3 text-xs font-bold text-slate-500 uppercase">商品名 / リンク</th>
                  <th className="p-3 text-xs font-bold text-slate-500 uppercase">AI分析コメント</th>
              </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
              {displayItems.map((i,x)=>(
                  <tr key={x} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 align-middle text-center"><RiskBadge item={i}/></td>
                      <td className="p-3 align-middle text-center">
                          {i.imageUrl ? (
                              <img src={i.imageUrl} alt="" className="w-12 h-12 object-cover rounded border border-slate-200 bg-white" loading="lazy"/>
                          ) : (
                              <div className="w-12 h-12 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-300"><ImageIcon className="w-5 h-5"/></div>
                          )}
                      </td>
                      <td className="p-3 align-middle">
                          <div className="font-bold mb-1 text-slate-800 line-clamp-2 text-xs leading-relaxed">{i.productName}</div>
                          {i.itemUrl!=='#'&&<a href={i.itemUrl} target="_blank" className="text-blue-500 text-[10px] hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3"/> 商品ページへ</a>}
                      </td>
                      <td className="p-3 align-middle">
                          <div className={`text-xs leading-relaxed p-2 rounded ${i.risk==='高'||i.isCritical ? 'bg-red-50 text-red-800 border border-red-100' : 'text-slate-600'}`}>
                              {i.reason}
                          </div>
                      </td>
                  </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SinglePatrolView = ({ config, db, addToast }) => {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('idle');
  const [meta, setMeta] = useState({ count: 0, estimatedTime: 0 });
  const [progress, setProgress] = useState({ processed: 0, remainingTime: 0, startTime: 0 });
  const [res, setRes] = useState([]);
  const [msg, setMsg] = useState('');
  const stopRef = useRef(false);

  const checkShop = async () => {
    if(!url || !config.apiKeys.length || !config.rakutenAppId) return addToast("URL, Rakuten AppID, Gemini API Keyが必要です", "error");
    
    setStatus('checking');
    setMsg("ショップ情報を取得中...");
    
    try {
        const u = new URL('/api/rakuten', window.location.origin);
        u.searchParams.append('shopUrl', url);
        u.searchParams.append('appId', config.rakutenAppId);
        u.searchParams.append('page', 1);

        const r = await fetch(u);
        if(!r.ok) {
            const err = await r.json();
            throw new Error(err.error_description || err.error || '楽天APIエラー');
        }
        const d = await r.json();
        
        const count = d.count || 0;
        
        // 推定時間の最適化：並列数に応じて計算
        // キーが5個あれば、バッチ15件を約2秒で処理と仮定 -> 7.5件/秒
        const concurrency = Math.max(1, config.apiKeys.length * 2);
        const estTime = Math.ceil(count / concurrency * 1.2); 

        setMeta({ count, estimatedTime: estTime });
        setStatus('ready');
        addToast(`商品数: ${count}件を取得しました`, "success");
    } catch(e) {
        console.error(e);
        addToast(`エラー: ${e.message}`, "error");
        setStatus('idle');
    }
    setMsg("");
  };

  const start = async () => {
    setStatus('running');
    setRes([]); 
    setMsg("パトロール開始..."); 
    stopRef.current = false;
    
    const startTime = Date.now();
    setProgress({ processed: 0, remainingTime: meta.estimatedTime, startTime });

    let p = 1;
    let processedCount = 0;
    let all = [];
    
    // パフォーマンス向上: APIキーの数に応じて並列数を増やす
    // キー1つにつき並列数3まで安全と仮定し、最大15並列（5キーの場合）
    const BATCH = Math.min(config.apiKeys.length * 3, 20); 

    try {
      while(true) {
        if(stopRef.current) break;
        setMsg(`ページ ${p} 取得中...`);
        
        const u = new URL('/api/rakuten', window.location.origin);
        u.searchParams.append('shopUrl', url);
        u.searchParams.append('appId', config.rakutenAppId);
        u.searchParams.append('page', p);
        
        let d = null;
        try {
            const r = await fetch(u);
            if(!r.ok) throw new Error('Fetch Error');
            d = await r.json();
        } catch(e) {
            console.error("Page fetch error", e);
            break; 
        }

        if(!d.products?.length) break;

        setMsg(`ページ ${p}: ${d.products.length}件 高速分析中 (並列数:${BATCH})...`);
        
        for(let i=0; i<d.products.length; i+=BATCH) {
          if(stopRef.current) break;
          const batchItems = d.products.slice(i, i+BATCH);
          
          // 並列リクエスト実行
          const results = await Promise.all(batchItems.map(b => analyzeItemRisk({productName:b.name, imageUrl:b.imageUrl}, config.apiKeys)));
          const batchResults = batchItems.map((b,x) => ({...b, ...results[x], risk: results[x].risk_level, isCritical: results[x].is_critical}));
          
          all = [...all, ...batchResults];
          setRes(prev => [...prev, ...batchResults]);
          
          processedCount += batchItems.length;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = processedCount / elapsed; 
          const remainingItems = meta.count - processedCount;
          const remTime = speed > 0 ? remainingItems / speed : 0;
          
          setProgress({ processed: processedCount, remainingTime: remTime, startTime });
          
          // 待機時間を短縮（負荷分散されているため）
          await new Promise(r=>setTimeout(r, 800));
        }
        
        if (processedCount >= meta.count) break;
        p++; 
        if(p > 100) break;
      }
      
      if(!stopRef.current && db) {
        try {
            await addDoc(collection(db, 'check_sessions'), { type:'url', target:url, createdAt:serverTimestamp(), status:'completed', summary:{total:all.length, high:all.filter(i=>i.risk==='高'||i.risk==='High').length, critical:all.filter(i=>i.isCritical).length}, details:all });
        } catch(e) { console.error('DB Save failed:', e); }
      }
      addToast("スキャン完了", "success");
      setStatus('completed');
    } catch(e){ 
        console.error(e); 
        addToast(`エラー: ${e.message}`, "error"); 
        setStatus('idle');
    }
    setMsg("");
  };

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-4 flex-shrink-0">
        <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-blue-600"/> 通常パトロール (高速モード)</h2>
        <div className="flex gap-2 mb-4">
          <input value={url} onChange={e=>setUrl(e.target.value)} disabled={status==='running'||status==='checking'} className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="ショップURL (例: https://www.rakuten.co.jp/shop-sample)" />
          {status === 'idle' || status === 'completed' || status === 'ready' ? (
              <button onClick={checkShop} disabled={status==='checking'} className="px-6 rounded-lg font-bold text-white bg-slate-600 hover:bg-slate-700 transition-colors flex items-center gap-2">
                {status==='checking' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4"/>}
                調査
              </button>
          ) : (
              <button onClick={()=>stopRef.current=true} className="px-6 rounded-lg font-bold text-white bg-red-500 hover:bg-red-600 transition-colors">停止</button>
          )}
        </div>
        {status !== 'idle' && status !== 'checking' && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-2 flex items-center justify-between animate-in slide-in-from-top-2">
                <div className="flex gap-6 text-sm">
                    <div><span className="text-slate-500 block text-xs">商品数</span><span className="font-bold text-lg">{meta.count.toLocaleString()}</span> <span className="text-xs">件</span></div>
                    <div><span className="text-slate-500 block text-xs">予想時間</span><span className="font-bold text-lg text-slate-700">約{Math.ceil(meta.estimatedTime / 60)}</span> <span className="text-xs">分</span></div>
                    {status === 'running' && (
                        <div><span className="text-slate-500 block text-xs">残り時間</span><span className="font-bold text-lg text-blue-600">{formatTime(progress.remainingTime)}</span></div>
                    )}
                </div>
                {status === 'ready' && (
                    <button onClick={start} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2 rounded-lg font-bold shadow-md transition-all hover:scale-105 flex items-center gap-2">
                        <PlayCircle className="w-5 h-5"/> パトロール開始
                    </button>
                )}
            </div>
        )}
        {msg && <p className="mt-2 text-sm text-blue-600 font-bold animate-pulse flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/> {msg}</p>}
      </div>
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        {res.length===0 ? 
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                <Search className="w-12 h-12 mb-2 opacity-20"/>
                <p>URLを入力して「調査」ボタンを押してください</p>
                <p className="text-[10px] mt-2 opacity-60">※有効なAPIキーが多いほど高速に処理されます</p>
            </div> 
            : <ResultTable items={res} title={`スキャン結果 (${res.length}/${meta.count})`} />}
      </div>
    </div>
  );
};

const BulkPatrolView = ({ config, db, addToast, stopRef, resume }) => {
  const [urls, setUrls] = useState('');
  const [proc, setProc] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stat, setStat] = useState({ total:0, done:0, items:0, cur:'', shops:[] });
  
  useEffect(() => {
    if(resume) {
      setUrls(resume.shopList?.map(s=>s.url).join('\n')||'');
      setStat(p=>({...p, total:resume.shopList.length, done:resume.shopList.filter(s=>s.status==='completed').length, shops:resume.shopList, items:resume.summary?.total||0, sid:resume.id}));
      addToast("再開準備OK", "info");
    }
  }, [resume]);

  const addLog = m => setLogs(p => [`[${new Date().toLocaleTimeString()}] ${m}`, ...p].slice(0,50));
  
  const save = async (sid, shops, sum, newD=[]) => {
    if(!db || !sid) return;
    try {
      const { arrayUnion } = await import('firebase/firestore');
      const up = { shopList:shops, summary:sum, updatedAt:serverTimestamp() };
      if(newD.length) { up.details = arrayUnion(...newD); }
      await updateDoc(doc(db,'check_sessions',sid), up);
    } catch(e){ console.error(e); }
  };

  const run = async () => {
    let sList = stat.shops, sid = stat.sid, totalI = stat.items;
    if(!config.apiKeys.length || !config.rakutenAppId) return addToast("設定でAPIキーとAppIDを入力してください", "error");

    if(!resume) {
      const ul = urls.split('\n').map(u=>u.trim()).filter(u=>u.startsWith('http'));
      if(!ul.length) return addToast("有効なURLがありません", "error");
      sList = ul.map(u=>({url:u, status:'waiting', itemCount:0}));
      
      if(db) {
          try {
             const d = await addDoc(collection(db,'check_sessions'), { type:'bulk_url', target:`一括(${ul.length})`, createdAt:serverTimestamp(), status:'processing', shopList:sList, summary:{total:0, high:0, critical:0}, details:[] });
             sid = d.id;
          } catch(e){}
      }
    }
    setProc(true); stopRef.current = false;
    setStat(p=>({...p, total:sList.length, sid}));
    addLog("🚀 一括パトロール開始");

    // 高速化: 5キーあれば15並列まで許容
    const BATCH = Math.min(config.apiKeys.length * 3, 15);

    for(let i=0; i<sList.length; i++) {
      if(stopRef.current) break;
      if(sList[i].status==='completed') continue;
      
      sList[i].status='processing';
      setStat(p=>({...p, cur:sList[i].url, done:i, shops:[...sList]}));
      addLog(`[${i+1}/${sList.length}] ${sList[i].url} 開始 (並列:${BATCH})`);
      
      let p=1, shopI=[], hasN=true;
      try {
        while(hasN) {
          if(stopRef.current) break;
          let d = null;
          try {
              const u = new URL('/api/rakuten', window.location.origin);
              u.searchParams.append('shopUrl', sList[i].url);
              u.searchParams.append('appId', config.rakutenAppId);
              u.searchParams.append('page', p);
              
              const r = await fetch(u);
              if(!r.ok) throw new Error(`Fetch failed ${r.status}`);
              d = await r.json();
          } catch(fetchErr) {
             console.error(fetchErr);
             addLog(`⚠️ ページ取得エラー (P${p}) - スキップ`);
             hasN = false;
             break;
          }

          if(!d.products?.length) { hasN=false; break; }
          
          for(let j=0; j<d.products.length; j+=BATCH) {
            if(stopRef.current) break;
            const b = d.products.slice(j, j+BATCH);
            
            // 複数のキーを使って並列処理
            const results = await Promise.all(b.map(async x => {
                try {
                    return await analyzeItemRisk({productName:x.name, imageUrl:x.imageUrl}, config.apiKeys);
                } catch(err) {
                    return { risk_level: "エラー", reason: "解析失敗" };
                }
            }));

            const res = b.map((x,k)=>({...x, ...results[k], risk:results[k].risk_level, isCritical:results[k].is_critical}));
            shopI=[...shopI,...res];
            
            // 待機時間を短縮
            await new Promise(r=>setTimeout(r, 800));
          }
          
          if(p%5===0) { 
              sList[i].itemCount=shopI.length; 
              await save(sid, sList, {total:totalI+shopI.length, high:0, critical:0}); 
              addLog(`... ${shopI.length}件処理中`);
          }
          
          p++; 
          if(p>50) {
              addLog("⚠️ ページ上限到達 - 次へ");
              break; 
          }
        }
        
        if(!stopRef.current) {
          sList[i].status='completed'; sList[i].itemCount=shopI.length; totalI+=shopI.length;
          await save(sid, sList, {total:totalI, high:0, critical:0}, shopI.filter(x=>x.isCritical||x.risk==='高'||x.risk==='High'));
          addLog(`✅ 完了: ${shopI.length}件`);
        }
      } catch(e){ 
          sList[i].status='error'; 
          addLog("❌ ショップエラー - スキップします"); 
          console.error(e);
      }
      await new Promise(r=>setTimeout(r, 1500));
    }
    setProc(false);
    if(db && sid) await updateDoc(doc(db,'check_sessions',sid), {status:stopRef.current?'paused':'completed', updatedAt:serverTimestamp()});
    addToast(stopRef.current?"一時停止":"全ショップ完了", "success");
  };

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-500">
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg flex-shrink-0 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full blur-3xl opacity-10 pointer-events-none translate-x-1/2 -translate-y-1/2"></div>
        <div className="flex justify-between mb-4 relative z-10">
          <div><h2 className="text-xl font-bold flex items-center gap-2"><Moon className="w-5 h-5 text-yellow-400"/> 一括夜間パトロール (高速モード)</h2></div>
          <div className="text-right"><div className="text-2xl font-bold font-mono text-blue-400">{stat.items.toLocaleString()}</div><div className="text-[10px] text-slate-400">チェック済み商品数</div></div>
        </div>
        {proc ? (
          <div className="bg-slate-800/80 backdrop-blur p-4 rounded-xl border border-slate-700 relative z-10">
            <div className="flex justify-between items-center mb-2"><span className="font-bold flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin text-blue-400"/> 処理中: {stat.done+1} / {stat.total}</span><button onClick={()=>stopRef.current=true} className="text-xs bg-red-500/20 hover:bg-red-500/40 text-red-400 px-3 py-1 rounded border border-red-500/30 transition-colors">停止</button></div>
            <div className="text-xs font-mono text-slate-400 truncate mb-2">{stat.cur}</div>
            <div className="h-32 overflow-y-auto font-mono text-[10px] text-green-400 bg-black/50 p-3 rounded-lg border border-white/5 custom-scrollbar">{logs.map((l,i)=><div key={i}>{l}</div>)}</div>
          </div>
        ) : (
          <div className="bg-slate-800/80 backdrop-blur p-4 rounded-xl border border-slate-700 relative z-10">
            <textarea value={urls} onChange={e=>setUrls(e.target.value)} disabled={!!resume} className="w-full h-32 bg-slate-900/50 border border-slate-600 rounded-lg p-3 text-xs text-slate-300 font-mono focus:outline-none focus:border-blue-500 transition-colors" placeholder={`https://www.rakuten.co.jp/shop-a/\nhttps://www.rakuten.co.jp/shop-b/\n...`} />
            <div className="mt-3 flex justify-between items-center">
              <p className="text-[10px] text-slate-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> 電源接続推奨</p>
              <button onClick={run} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg shadow-blue-900/50 transition-all hover:translate-y-[-1px]"><PlayCircle className="w-4 h-4"/> {resume?'再開':'開始'}</button>
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-3 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-bold text-slate-700 text-sm flex gap-2 items-center"><List className="w-4 h-4"/> キューの状況</h3><span className="text-xs font-mono bg-slate-200 px-2 py-0.5 rounded text-slate-600">{stat.shops.filter(s=>s.status==='completed').length} / {stat.shops.length}</span></div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {stat.shops.length === 0 && <div className="text-center text-slate-400 text-xs py-10">URLリストが空です</div>}
          {stat.shops.map((s,i)=><div key={i} className={`flex justify-between p-3 rounded-lg border text-xs transition-colors ${s.status==='processing'?'bg-blue-50 border-blue-200 shadow-sm':s.status==='completed'?'bg-white opacity-60 border-slate-100':'bg-slate-50 border-transparent'}`}><span className="truncate w-2/3 flex items-center gap-2">{s.status==='completed' && <CheckCircle className="w-3 h-3 text-green-500"/>} {s.url}</span><span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase ${s.status==='processing'?'text-blue-600 bg-blue-100':s.status==='completed'?'text-green-600 bg-green-100':'text-slate-400 bg-slate-200'}`}>{s.status}</span></div>)}
        </div>
      </div>
    </div>
  );
};

const SettingsView = ({ config, setConfig, addToast }) => {
  const [k, setK] = useState(config.apiKeys.join('\n'));
  const [checking, setChecking] = useState(false);
  const [keyStatus, setKeyStatus] = useState({});

  const save = () => {
    const keys = k.split('\n').map(x=>x.trim()).filter(x=>x);
    setConfig({...config, apiKeys:keys, rakutenAppId:config.rakutenAppId, firebaseJson:config.firebaseJson});
    localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
    localStorage.setItem('rakuten_app_id', config.rakutenAppId);
    localStorage.setItem('firebase_config', config.firebaseJson);
    addToast("設定を保存しました", "success");
  };

  const checkKeys = async () => {
    const keys = k.split('\n').map(x=>x.trim()).filter(x=>x);
    if (keys.length === 0) return addToast("APIキーが入力されていません", "error");
    
    setChecking(true);
    setKeyStatus({});
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const res = await checkApiKeyHealth(key);
        setKeyStatus(prev => ({...prev, [i]: res}));
        await new Promise(r => setTimeout(r, 500)); // 間隔を空ける
    }
    setChecking(false);
    addToast("チェック完了", "success");
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-lg font-bold mb-6 flex items-center gap-2 pb-4 border-b"><Settings className="w-5 h-5"/> システム設定</h2>
      <div className="space-y-6">
        <div>
            <div className="flex justify-between items-end mb-1">
                <label className="text-xs font-bold text-slate-500">Gemini API Keys (1行に1つ)</label>
                <button onClick={checkKeys} disabled={checking} className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-slate-600 flex items-center gap-1 transition-colors">
                    {checking ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>} 健全性チェック
                </button>
            </div>
            <div className="relative">
                <textarea value={k} onChange={e=>setK(e.target.value)} className="w-full p-3 border border-slate-200 rounded-lg h-32 text-xs font-mono focus:ring-2 focus:ring-slate-200 outline-none leading-loose" placeholder="Gemini APIキーを入力してください"/>
                <div className="absolute top-3 right-3 flex flex-col gap-2">
                    {k.split('\n').map((_, i) => keyStatus[i] && (
                        <div key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold flex items-center gap-1 ${keyStatus[i].ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {keyStatus[i].ok ? <Wifi className="w-3 h-3"/> : <WifiOff className="w-3 h-3"/>}
                            {keyStatus[i].ok ? 'OK' : `ERR(${keyStatus[i].status})`}
                        </div>
                    ))}
                </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">※複数のキーを登録すると、自動的に負荷分散を行い高速化・安定化します。</p>
        </div>
        <div><label className="text-xs font-bold text-slate-500 mb-1 block">Rakuten App ID</label><input value={config.rakutenAppId} onChange={e=>setConfig({...config, rakutenAppId:e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-200 outline-none"/></div>
        <div><label className="text-xs font-bold text-slate-500 mb-1 block">Firebase Config JSON</label><textarea value={config.firebaseJson} onChange={e=>setConfig({...config, firebaseJson:e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg h-24 text-xs font-mono focus:ring-2 focus:ring-slate-200 outline-none" placeholder='{"apiKey": "...", ...}'/></div>
        <button onClick={save} className="w-full py-3 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-700 transition-colors shadow-lg">設定を保存</button>
      </div>
    </div>
  );
};

// --- Main App Component ---
export default function App() {
  const [login, setLogin] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [tab, setTab] = useState('dashboard');
  const [conf, setConf] = useState({ apiKeys:[], rakutenAppId:'', firebaseJson:'' });
  const [db, setDb] = useState(null);
  const [dbSt, setDbSt] = useState('..');
  const [hist, setHist] = useState([]); 
  const [ins, setIns] = useState(null);
  const [res, setRes] = useState(null);
  
  const stopRef = useRef(false);

  const toast = (m,t='info') => { const id=Date.now(); setToasts(p=>[...p,{id,message:m,type:t}]); setTimeout(()=>setToasts(p=>p.filter(x=>x.id!==id)),4000); };
  
  useEffect(() => {
    const k = JSON.parse(localStorage.getItem('gemini_api_keys')||'[]');
    const r = localStorage.getItem('rakuten_app_id')||'';
    const f = localStorage.getItem('firebase_config')||'';
    setConf({apiKeys:k, rakutenAppId:r, firebaseJson:f});
    
    if(localStorage.getItem('app_auth')==='true') setLogin(true);
    
    if(f) {
      try {
        const c = parseFirebaseConfig(f);
        if(c) { 
            const app = getApps().length?getApp():initializeApp(c); 
            const firestore = getFirestore(app);
            setDb(firestore); 
            setDbSt('OK'); 
            
            const q = query(collection(firestore,'check_sessions'), orderBy('createdAt','desc'), limit(20));
            onSnapshot(q, s => {
                setHist(s.docs.map(d=>({id:d.id,...d.data()})));
            });
        }
      } catch(e){ setDbSt('ERR'); }
    } else {
        setDbSt('No Config');
    }
  }, []);

  if(!login) return <LoginView onLogin={async(p)=>{ if(p===APP_CONFIG.FIXED_PASSWORD){setLogin(true); localStorage.setItem('app_auth','true'); toast('ログイン成功', 'success');}else toast('パスワードが間違っています', 'error'); }}/>;

  return (
    <div className="h-screen bg-slate-50 font-sans text-slate-800 flex flex-col overflow-hidden">
      <ToastContainer toasts={toasts} removeToast={id=>setToasts(p=>p.filter(t=>t.id!==id))} />
      <header className="bg-white border-b h-16 flex items-center justify-between px-6 sticky top-0 z-20 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2 font-bold text-lg text-slate-800"><div className="bg-slate-800 p-1.5 rounded-lg"><Bot className="w-5 h-5 text-white"/></div> Rakuten Patrol Pro <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-2">v{APP_CONFIG.VERSION}</span></div>
        <div className="flex items-center gap-4 text-xs font-bold text-slate-500">
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${dbSt==='OK'?'bg-emerald-100 text-emerald-700':dbSt==='No Config'?'bg-slate-200 text-slate-600':'bg-amber-100 text-amber-700'}`}>
                <div className={`w-2 h-2 rounded-full ${dbSt==='OK'?'bg-emerald-500':dbSt==='No Config'?'bg-slate-400':'bg-amber-500'}`}></div>
                DB: {dbSt==='OK'?'接続済み':dbSt==='No Config'?'未設定':'エラー'}
            </span>
            <button onClick={()=>{setLogin(false); localStorage.removeItem('app_auth');}} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-red-500"><LogOut className="w-4 h-4"/></button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 bg-white border-r flex flex-col p-4 space-y-1 hidden md:flex flex-shrink-0 z-10">
          <div className="text-[10px] font-bold text-slate-400 uppercase px-4 mb-2 tracking-wider">メインメニュー</div>
          <NavButton icon={LayoutDashboard} label="ダッシュボード" id="dashboard" active={tab} onClick={setTab} />
          <NavButton icon={ShoppingBag} label="通常パトロール" id="single" active={tab} onClick={setTab} />
          <div className="border-b border-slate-100 my-3 mx-2"></div>
          <NavButton icon={Moon} label="一括夜間パトロール" id="bulk" active={tab} onClick={()=>{setRes(null);setTab('bulk');}} />
          <NavButton icon={History} label="実行履歴" id="history" active={tab} onClick={setTab} />
          <div className="border-b border-slate-100 my-3 mx-2"></div>
          <NavButton icon={Settings} label="システム設定" id="settings" active={tab} onClick={setTab} />
          
          <div className="mt-auto bg-slate-50 p-4 rounded-xl border border-slate-100">
            <h4 className="font-bold text-xs text-slate-500 mb-2">システム状態</h4>
            <div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div> 全システム正常稼働中</div>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative bg-slate-50/50">
          {tab==='dashboard' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
              <div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-1">お疲れ様です、管理者様</h2>
                  <p className="text-slate-500 text-sm">本日のパトロール状況とアラートの概要です。</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard title="本日のスキャン" value={hist.filter(x=>new Date(x.createdAt?.seconds*1000).getDate()===new Date().getDate()).length} icon={Activity} color="bg-blue-500" subtext="件のセッション" />
                <StatCard title="高リスク検知" value={hist.reduce((a,c)=>a+(c.summary?.critical||0),0)} icon={Siren} color="bg-red-500" subtext="直ちに対応が必要" />
                <StatCard title="データベース接続" value={dbSt==='OK'?'OK':'-'} icon={Cloud} color={dbSt==='OK'?'bg-emerald-500':'bg-amber-500'} subtext={dbSt==='No Config'?'未接続':'接続完了'} />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div onClick={()=>setTab('single')} className="bg-gradient-to-br from-blue-600 to-blue-700 p-8 rounded-2xl shadow-lg shadow-blue-200 text-white cursor-pointer hover:scale-[1.02] transition-transform relative overflow-hidden group">
                      <ShoppingBag className="w-12 h-12 mb-4 text-white/80 group-hover:text-white transition-colors"/>
                      <h3 className="font-bold text-xl">通常パトロール</h3>
                      <p className="text-blue-100 text-sm mt-2 opacity-80">特定ショップをスキャン</p>
                      <ChevronRight className="absolute bottom-6 right-6 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0"/>
                  </div>
                  <div onClick={()=>{setRes(null);setTab('bulk');}} className="bg-gradient-to-br from-slate-800 to-slate-900 p-8 rounded-2xl shadow-lg shadow-slate-300 text-white cursor-pointer hover:scale-[1.02] transition-transform relative overflow-hidden group">
                      <Moon className="w-12 h-12 mb-4 text-yellow-400"/>
                      <h3 className="font-bold text-xl">夜間一括モード</h3>
                      <p className="text-slate-400 text-sm mt-2">複数店舗を自動巡回</p>
                      <ChevronRight className="absolute bottom-6 right-6 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0"/>
                  </div>
              </div>
            </div>
          )}
          <div className={tab==='single'?'block h-full max-w-5xl mx-auto':'hidden'}><SinglePatrolView config={conf} db={db} addToast={toast} /></div>
          <div className={tab==='bulk'?'block h-full max-w-5xl mx-auto':'hidden'}><BulkPatrolView config={conf} db={db} addToast={toast} stopRef={stopRef} resume={res} /></div>
          {tab==='history' && (
            <div className="bg-white rounded-xl border shadow-sm p-6 h-full overflow-y-auto max-w-5xl mx-auto animate-in fade-in">
              <h2 className="font-bold mb-6 flex items-center gap-2 text-lg"><History className="w-5 h-5"/> 実行履歴</h2>
              <div className="space-y-3">
                {hist.length === 0 && <div className="text-center text-slate-400 py-10">履歴はありません</div>}
                {hist.map(h=><div key={h.id} onClick={()=>{setIns(h);setTab('inspect');}} className="flex justify-between p-4 border border-slate-100 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors group"><div className="flex gap-4 items-center"><div className={`p-3 rounded-lg ${h.type==='bulk_url'?'bg-purple-100 text-purple-600':'bg-blue-100 text-blue-600'}`}>{h.type==='bulk_url'?<List className="w-5 h-5"/>:<ShoppingBag className="w-5 h-5"/>}</div><div><div className="truncate font-bold text-slate-800">{h.target}</div><div className="text-xs text-slate-400 mt-0.5">{new Date(h.createdAt?.seconds*1000).toLocaleString()}</div></div></div><div className="flex gap-3 items-center text-xs"><span className={`px-3 py-1 rounded-full font-bold ${h.status==='completed'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{h.status}</span>{(h.status==='paused'||h.status==='aborted')&&h.type==='bulk_url'&&<button onClick={(e)=>{e.stopPropagation();setRes(h);setTab('bulk');}} className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold">再開</button>}<ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500"/></div></div>)}
              </div>
            </div>
          )}
          {tab==='inspect' && ins && <div className="max-w-5xl mx-auto h-full"><ResultTable items={ins.details||[]} title={ins.target} onBack={()=>setTab('history')} /></div>}
          {tab==='settings' && <SettingsView config={conf} setConfig={setConf} addToast={toast} />}
        </main>
      </div>
    </div>
  );
}