import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ShoppingBag, CheckCircle, Loader2, ShieldAlert, Trash2, Zap, FolderOpen, 
  Lock, LogOut, History, Settings, Search, ExternalLink, Siren, User, X, 
  LayoutDashboard, ChevronRight, Calendar, Folder, FileSearch, ChevronDown, 
  ArrowLeft, Store, Info, PlayCircle, Terminal, Activity, Cloud, ImageIcon, 
  Bot, List, Power, Moon, Clock, RefreshCw, AlertTriangle, Bug, Timer, Filter,
  Check, Wifi, WifiOff, PauseCircle, Download, Gavel, Scale, Eye, EyeOff, FastForward,
  Layers, RotateCcw, StopCircle, Database, ToggleLeft, ToggleRight
} from 'lucide-react';
import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, 
  serverTimestamp, where, getDocs, deleteDoc, doc, updateDoc, getDoc 
} from 'firebase/firestore';

/**
 * ============================================================================
 * Rakuten Patrol Pro - Crash Fix & Robust Edition (v19.7)
 * ============================================================================
 */

const APP_CONFIG = {
  FIXED_PASSWORD: 'admin', 
  API_TIMEOUT: 45000, 
  RETRY_LIMIT: 3,     
  VERSION: '19.7.0-CrashFix'
};

const parseFirebaseConfig = (input) => {
  if (!input) return null;
  try { return JSON.parse(input); } catch (e) {
    try {
      // JSオブジェクト形式でも許容する柔軟なパース
      let jsonStr = input.replace(/^(const|var|let)\s+\w+\s*=\s*/, '').replace(/;\s*$/, '').replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"');
      return JSON.parse(jsonStr);
    } catch (e2) { return null; }
  }
};

// 安全な日付フォーマット関数 (ホワイトアウト防止の要)
const formatDate = (timestamp) => {
  if (!timestamp) return '日時不明 (処理中)';
  try {
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toLocaleString();
    if (timestamp.seconds) return new Date(timestamp.seconds * 1000).toLocaleString();
    if (timestamp instanceof Date) return timestamp.toLocaleString();
  } catch (e) {
    return '日時形式エラー';
  }
  return '日時不明';
};

// --- プログレスバー ---
const ProgressBar = ({ current, total, label, color = "bg-blue-600", subLabel }) => {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1 font-bold text-slate-500">
        <span>{label}</span>
        <span>{subLabel || `${percent}% (${current.toLocaleString()}/${total.toLocaleString()})`}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
        <div 
          className={`h-2.5 rounded-full transition-all duration-300 ${color}`} 
          style={{ width: `${percent}%` }}
        ></div>
      </div>
    </div>
  );
};

// --- API Wrapper ---
async function callGeminiDirectly(apiKey, prompt, isTest = false) {
    const cleanKey = apiKey.trim().replace(/[\r\n\s]/g, '');
    const model = 'gemini-2.5-flash'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), isTest ? 10000 : APP_CONFIG.API_TIMEOUT);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No response from AI');
        
        return text;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

async function analyzeItemRisk(itemData, apiKeys, retryCount = 0) {
  const keyIndex = (Math.floor(Math.random() * apiKeys.length) + retryCount) % apiKeys.length;
  const currentKey = apiKeys.length > 0 ? apiKeys[keyIndex] : '';
  const pName = itemData.productName || "（商品名不明）";

  const prompt = `
    あなたは知的財産権法（商標法、意匠法、著作権法、不正競争防止法）に精通した一流弁理士です。
    以下の商品情報から、権利侵害リスクおよび禁止商材を厳格に監査してください。

    商品名: "${pName}"
    ${itemData.imageUrl ? `商品画像URL: ${itemData.imageUrl}` : ''}

    【判定基準 (絶対厳守)】
    1. **[重大]**: 食品、飲料、サプリ、医薬品、化粧品、美容液、コンタクトレンズ、アダルトグッズ。（安全性・公序良俗の観点から即NG）
    2. **[高]**: 特定ブランド（例: ルイヴィトン、ナイキ、アニメキャラ等）のロゴ・デザインの無断使用、デッドコピー、「スーパーコピー」等の表記。
    3. **[中]**: 「〇〇風」「〇〇タイプ」等の便乗商品、またはデザインが酷似しているグレーゾーン。
    4. **[低]**: 上記に該当しない一般的なノーブランド品、正規流通品。

    【出力要件】
    - JSON形式のみで出力。Markdown装飾は不可。
    - **reason**: 「どのブランド/商品の」「どの権利（商標権/意匠権/著作権等）」に抵触する可能性があるかを具体的に特定し、50〜80文字程度で記述すること。
    - 食品等は「安全性の観点から販売禁止」と明記。

    出力フォーマット:
    {"risk_level": "重大"|"高"|"中"|"低", "is_critical": boolean, "reason": "具体的な法的根拠とリスク理由"}
  `;

  try {
    const aiResponseText = await callGeminiDirectly(currentKey, prompt);
    const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
    const aiResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { risk_level: "不明", is_critical: false, reason: "解析不能" };
    return aiResult;

  } catch (error) {
    if ((error.message.includes('429') || error.message.includes('503')) && retryCount < APP_CONFIG.RETRY_LIMIT) {
        const waitTime = Math.pow(1.5, retryCount) * 300; 
        await new Promise(r => setTimeout(r, waitTime));
        return analyzeItemRisk(itemData, apiKeys, retryCount + 1);
    }
    return { risk_level: "エラー", reason: error.message };
  }
}

async function checkApiKeyHealth(apiKey) {
    try {
        await callGeminiDirectly(apiKey, "Reply with 'OK'.", true);
        return { ok: true, status: 200, msg: 'OK' };
    } catch (e) {
        return { ok: false, status: 'ERR', msg: e.message };
    }
}

async function checkRakutenAppId(appId) {
    if(!appId) return { ok: false, msg: 'App IDが空です' };
    try {
        const testUrl = "https://www.rakuten.co.jp/rakuten24/";
        const u = new URL('/api/rakuten', window.location.origin);
        u.searchParams.append('shopUrl', testUrl);
        u.searchParams.append('appId', appId);
        u.searchParams.append('page', 1);
        const r = await fetch(u);
        const d = await r.json();
        if (r.ok && !d.error && !d.error_description) {
            return { ok: true, msg: 'OK' };
        } else {
            return { ok: false, msg: d.error_description || d.error || '認証エラー' };
        }
    } catch(e) {
        return { ok: false, msg: e.message };
    }
}

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
  const { risk_level, is_critical, reason } = item;
  const r = reason || "";
  const isBanned = r.includes("食品") || r.includes("美容") || r.includes("化粧") || r.includes("医薬") || r.includes("アダルト");
  
  if (isBanned || risk_level === '重大') return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 gap-1 items-center whitespace-nowrap"><Bug className="w-3 h-3"/> 禁止商材</span>;
  if (risk_level === '高' || is_critical) return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 gap-1 items-center whitespace-nowrap"><Gavel className="w-3 h-3"/> 権利侵害</span>;
  if (risk_level === '中') return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">要確認</span>;
  if (risk_level === 'エラー') return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">エラー</span>;
  return <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">OK</span>;
};

const StatCard = ({ title, value, icon: Icon, color, subtext, onClick }) => (
  <div onClick={onClick} className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 transition-all hover:scale-[1.02] ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}>
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
        <div className="mb-8"><div className="inline-flex p-4 bg-slate-800 rounded-xl mb-4 shadow-lg"><Gavel className="w-8 h-8 text-white"/></div><h1 className="text-xl font-bold text-slate-800">Rakuten Patrol <span className="text-blue-600">Pro</span></h1></div>
        <form onSubmit={(e)=>{e.preventDefault(); setL(true); setTimeout(() => onLogin(p).finally(()=>setL(false)), 800);}} className="space-y-4">
          <input type="password" value={p} onChange={e=>setP(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg font-bold text-center" placeholder="ACCESS KEY" required />
          <button disabled={l} className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">{l ? <Loader2 className="w-5 h-5 animate-spin mx-auto"/> : "LOGIN"}</button>
        </form>
      </div>
    </div>
  );
};

const ResultTable = ({ items, title, onBack }) => {
  const [showAll, setShowAll] = useState(false);
  
  const displayItems = useMemo(() => {
    if (showAll) return items.slice(0, 500); 
    return items.filter(i => i.risk_level !== '低' && i.risk_level !== 'Low');
  }, [items, showAll]);

  const dl = () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let c = "Name,Risk,Reason,URL\n" + items.map(r=>`"${(r.productName||'').replace(/"/g,'""')}",${r.risk_level},"${(r.reason||'').replace(/"/g,'""')}",${r.itemUrl}`).join('\n');
    const u = URL.createObjectURL(new Blob([bom, c], {type:"text/csv"}));
    const a = document.createElement("a"); a.href=u; a.download="report.csv"; a.click();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex justify-between items-center p-4 pb-0">
        <div className="flex gap-3 items-center">{onBack&&<button onClick={onBack} className="p-2 bg-white border rounded-lg shadow-sm"><ArrowLeft className="w-4 h-4"/></button>}<h2 className="font-bold text-slate-800 text-lg">{title}</h2></div>
        <div className="flex gap-2">
            <button onClick={() => setShowAll(!showAll)} className={`px-4 py-2 border rounded-lg text-sm font-bold shadow-sm flex items-center gap-2 ${showAll ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}><Filter className="w-4 h-4"/> {showAll ? '全件表示(最大500件)' : 'リスクのみ表示'}</button>
            <button onClick={dl} className="px-4 py-2 bg-white border rounded-lg text-sm font-bold text-slate-600 shadow-sm flex gap-2 items-center"><Download className="w-4 h-4"/> CSV(全件)</button>
        </div>
      </div>
      <div className="bg-white border-t border-slate-100 flex-1 overflow-y-auto p-0">
        {displayItems.length === 0 && !showAll && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <CheckCircle className="w-12 h-12 mb-2 text-emerald-200"/>
                <p>リスク商品は検出されていません</p>
            </div>
        )}
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm"><tr><th className="p-3 w-24 text-center">判定</th><th className="p-3 w-20 text-center">画像</th><th className="p-3 w-1/3">商品名 / リンク</th><th className="p-3">弁理士AIの所見 (具体的根拠)</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
              {displayItems.map((i,x)=>(
                  <tr key={x} className={`transition-colors ${i.risk_level==='重大'?'bg-purple-50':i.risk_level==='高'?'bg-red-50':i.risk_level==='中'?'bg-amber-50':'hover:bg-slate-50'}`}>
                      <td className="p-3 align-middle text-center"><RiskBadge item={i}/></td>
                      <td className="p-3 align-middle text-center">{i.imageUrl ? <img src={i.imageUrl} className="w-12 h-12 object-cover rounded border bg-white"/> : <ImageIcon className="w-8 h-8 text-slate-300 mx-auto"/>}</td>
                      <td className="p-3 align-middle"><div className="font-bold mb-1 line-clamp-2 text-xs">{i.productName}</div>{i.itemUrl&&<a href={i.itemUrl} target="_blank" className="text-blue-500 text-[10px] hover:underline inline-flex items-center gap-1"><ExternalLink className="w-3 h-3"/> 商品ページ</a>}</td>
                      <td className="p-3 align-middle"><div className="text-xs p-2 rounded bg-white/50 border border-slate-200/50 leading-relaxed">{i.reason}</div></td>
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
  const [meta, setMeta] = useState({ count: 0 });
  const [progress, setProgress] = useState({ processed: 0, remainingTime: 0, startTime: 0, currentPage: 1 });
  const [res, setRes] = useState([]);
  const [msg, setMsg] = useState('');
  const [sessionId, setSessionId] = useState(null); 
  const stopRef = useRef(false);

  const errorCount = useMemo(() => res.filter(i => i.risk_level === 'エラー').length, [res]);

  const checkShop = async () => {
    if(!url || !config.apiKeys.length || !config.rakutenAppId) return addToast("設定が不足しています", "error");
    setStatus('checking'); setMsg("ショップ情報取得中...");
    try {
        const u = new URL('/api/rakuten', window.location.origin);
        u.searchParams.append('shopUrl', url);
        u.searchParams.append('appId', config.rakutenAppId);
        u.searchParams.append('page', 1);
        const r = await fetch(u);
        const d = await r.json();
        if(!r.ok) throw new Error(d.error_description || 'API Error');
        
        setMeta({ count: d.count || 0 });
        setStatus('ready');
        setRes([]);
        setProgress({ processed: 0, remainingTime: 0, startTime: 0, currentPage: 1 });
        addToast(`${d.count}件の商品を検出`, "success");
    } catch(e) { addToast(e.message, "error"); setStatus('idle'); }
    setMsg("");
  };

  const start = async () => {
    setStatus('running'); setMsg("パトロール開始..."); stopRef.current = false;
    const startTime = Date.now();
    let p = progress.currentPage;
    let processedCount = progress.processed;
    let all = [...res];
    let currentSessionId = sessionId;

    // 初回のみDBドキュメント作成
    if (db && !currentSessionId) {
        try {
            const docRef = await addDoc(collection(db, 'check_sessions'), { 
                type: 'url', target: url, createdAt: serverTimestamp(), status: 'processing', 
                summary: { total: 0, high: 0, critical: 0 }, details: [] 
            });
            currentSessionId = docRef.id;
            setSessionId(currentSessionId);
        } catch(e) { console.error("DB Init Error", e); }
    }
    
    const BATCH = Math.min(config.apiKeys.length * 10, 60); 

    try {
      while(true) {
        if(stopRef.current) { 
            setStatus('paused'); 
            setMsg("一時停止中"); 
            addToast("一時停止しました", "info"); 
            setProgress(prev=>({...prev, currentPage:p, processed:processedCount})); 
            if(db && currentSessionId) await saveToDb(currentSessionId, all, 'paused'); 
            break; 
        }

        setMsg(`ページ ${p} 解析中... (並列数:${BATCH})`);
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
            addToast(`ページ${p}取得失敗 - スキップ`, "error");
            p++; continue; 
        }

        if(!d.products?.length) {
            if(!stopRef.current) { 
                setStatus('completed'); 
                addToast("完了", "success"); 
                if(db && currentSessionId) await saveToDb(currentSessionId, all, 'completed'); 
            }
            break;
        }
        
        for(let i=0; i<d.products.length; i+=BATCH) {
          if(stopRef.current) break;
          const batchItems = d.products.slice(i, i+BATCH);
          const results = await Promise.all(batchItems.map(b => analyzeItemRisk({productName:b.productName, imageUrl:b.imageUrl}, config.apiKeys)));
          const batchResults = batchItems.map((b,x) => ({...b, ...results[x]}));
          all = [...all, ...batchResults];
          setRes(prev => [...prev, ...batchResults]);
          
          processedCount += batchItems.length;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = processedCount / (elapsed || 1);
          const remainingItems = meta.count - processedCount;
          setProgress({ processed: processedCount, remainingTime: speed > 0 ? remainingItems/speed : 0, startTime, currentPage: p });
        }
        
        if (processedCount >= meta.count) {
             if(!stopRef.current) { 
                 setStatus('completed'); 
                 addToast("完了", "success"); 
                 if(db && currentSessionId) await saveToDb(currentSessionId, all, 'completed'); 
            }
            break;
        }
        if(stopRef.current) continue;
        p++; if(p > 1000) break;
      }
    } catch(e){ 
        console.error(e); 
        addToast("エラー発生", "error"); 
        setStatus('paused'); 
        if(db && currentSessionId) await saveToDb(currentSessionId, all, 'error'); 
    }
    if (status !== 'paused') setMsg("");
  };

  const retryErrors = async () => {
    const errorIndices = res.map((item, index) => item.risk_level === 'エラー' ? index : -1).filter(i => i !== -1);
    if (errorIndices.length === 0) return addToast("エラーの商品はありません", "info");

    setStatus('running'); setMsg(`再チェック中...`); stopRef.current = false;
    const BATCH = Math.min(config.apiKeys.length * 5, 20);
    
    let updatedRes = [...res];

    for (let i = 0; i < errorIndices.length; i += BATCH) {
        if (stopRef.current) break;
        const currentBatchIndices = errorIndices.slice(i, i + BATCH);
        const batchItems = currentBatchIndices.map(idx => res[idx]);
        const results = await Promise.all(batchItems.map(b => analyzeItemRisk({productName:b.productName, imageUrl:b.imageUrl}, config.apiKeys)));

        currentBatchIndices.forEach((resIdx, k) => {
            updatedRes[resIdx] = { ...updatedRes[resIdx], ...results[k] };
        });
        setRes([...updatedRes]);
        await new Promise(r => setTimeout(r, 500));
    }

    setStatus('completed');
    addToast("再チェック完了", "success");
    setMsg("");
    if(db && sessionId) await saveToDb(sessionId, updatedRes, 'completed');
  };

  const finish = async () => {
      stopRef.current = true;
      if (db && sessionId) await saveToDb(sessionId, res, 'completed'); 
      setStatus('idle');
      setUrl('');
      setRes([]);
      setSessionId(null);
      setProgress({ processed: 0, remainingTime: 0, startTime: 0, currentPage: 1 });
      addToast("終了しました", "info");
  };

  const saveToDb = async (sid, data, st) => {
      const riskyItems = data.filter(i => i.risk_level !== '低' && i.risk_level !== 'Low');
      try {
        await updateDoc(doc(db, 'check_sessions', sid), { 
            status: st, 
            summary: { 
                total: data.length, 
                high: data.filter(i=>i.risk_level==='高'||i.risk_level==='重大').length, 
                critical: data.filter(i=>i.is_critical).length 
            }, 
            details: riskyItems,
            updatedAt: serverTimestamp()
        });
      } catch(e) { console.error('DB Save Error', e); }
  };

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-4 flex-shrink-0">
        <h2 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><FastForward className="w-5 h-5 text-blue-600"/> 超高速パトロール</h2>
        <div className="flex gap-2 mb-4">
          <input value={url} onChange={e=>setUrl(e.target.value)} disabled={status==='running'||status==='paused'} className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="ショップURL" />
          
          {status === 'idle' && <button onClick={checkShop} className="px-6 rounded-lg font-bold text-white bg-slate-600 hover:bg-slate-700 transition-colors flex items-center gap-2"><Search className="w-4 h-4"/> 調査</button>}
          {status === 'checking' && <button disabled className="px-6 rounded-lg font-bold text-white bg-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> ...</button>}
          {status === 'ready' && <button onClick={start} className="px-6 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors flex items-center gap-2"><PlayCircle className="w-4 h-4"/> 開始</button>}
          {status === 'running' && <button onClick={()=>stopRef.current=true} className="px-6 rounded-lg font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-2"><PauseCircle className="w-4 h-4"/> 停止</button>}
          {status === 'paused' && (
              <>
                <button onClick={start} className="px-6 rounded-lg font-bold text-white bg-green-600 hover:bg-green-700 transition-colors flex items-center gap-2"><PlayCircle className="w-4 h-4"/> 再開</button>
                <button onClick={finish} className="px-6 rounded-lg font-bold text-white bg-slate-600 hover:bg-slate-700 transition-colors flex items-center gap-2"><StopCircle className="w-4 h-4"/> 終了</button>
              </>
          )}
          {status === 'completed' && (
              <>
                <button onClick={finish} className="px-6 rounded-lg font-bold text-white bg-slate-600 hover:bg-slate-700 transition-colors">リセット</button>
                {errorCount > 0 && (
                    <button onClick={retryErrors} className="px-6 rounded-lg font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-2">
                        <RotateCcw className="w-4 h-4"/> エラー再試行 ({errorCount})
                    </button>
                )}
              </>
          )}
        </div>

        {(status !== 'idle' && status !== 'checking') && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-2 animate-in slide-in-from-top-2">
                <div className="flex justify-between items-center mb-2">
                    <div className="w-full mr-4"><ProgressBar current={progress.processed} total={meta.count} label={status==='completed'?'完了':'進捗'} color={status==='completed'?'bg-green-500':status==='paused'?'bg-amber-500':'bg-blue-600'} /></div>
                </div>
                <div className="flex gap-6 text-sm mt-1 justify-end text-slate-500">
                    {(status === 'running' || status === 'paused') && <div>残り時間: <span className="font-bold text-slate-700">{formatTime(progress.remainingTime)}</span></div>}
                </div>
            </div>
        )}
        {msg && <p className="mt-2 text-sm text-blue-600 font-bold animate-pulse flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/> {msg}</p>}
      </div>
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <ResultTable items={res} title={`スキャン結果 (${res.length}/${meta.count})`} />
      </div>
    </div>
  );
};

const BulkPatrolView = ({ config, db, addToast, stopRef, resume }) => {
  const [urls, setUrls] = useState('');
  const [proc, setProc] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stat, setStat] = useState({ total:0, done:0, items:0, currentShopItems:0, currentShopTotal:0, shops:[], risks: 0 });
  const [resultsMap, setResultsMap] = useState({});
  const [sessionId, setSessionId] = useState(null);

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

  const dlAll = () => {
      const allItems = Object.values(resultsMap).flat();
      if(allItems.length === 0) return addToast("データがありません", "error");
      const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
      let c = "ShopURL,Name,Risk,Reason,ItemURL\n" + allItems.map(r=>`${r.shopUrl},"${(r.productName||'').replace(/"/g,'""')}",${r.risk_level},"${(r.reason||'').replace(/"/g,'""')}",${r.itemUrl}`).join('\n');
      const u = URL.createObjectURL(new Blob([bom, c], {type:"text/csv"}));
      const a = document.createElement("a"); a.href=u; a.download=`bulk_report_${Date.now()}.csv`; a.click();
  };

  const finish = async () => {
      stopRef.current = true;
      if (db && sessionId) await updateDoc(doc(db, 'check_sessions', sessionId), { status: 'completed', updatedAt: serverTimestamp() });
      setProc(false);
      setUrls('');
      setLogs([]);
      setSessionId(null);
      setStat({ total:0, done:0, items:0, currentShopItems:0, currentShopTotal:0, shops:[], risks: 0 });
      addToast("一括パトロール終了", "info");
  };

  const run = async () => {
    let sList = stat.shops, sid = stat.sid || sessionId, totalI = stat.items;
    if(!config.apiKeys.length || !config.rakutenAppId) return addToast("設定不足", "error");

    if(!resume && !proc) {
      const ul = urls.split('\n').map(u=>u.trim()).filter(u=>u.startsWith('http'));
      if(!ul.length) return addToast("URLなし", "error");
      sList = ul.map(u=>({url:u, status:'waiting', itemCount:0}));
      
      if(db) {
          try {
             const d = await addDoc(collection(db,'check_sessions'), { type:'bulk_url', target:`一括(${ul.length})`, createdAt:serverTimestamp(), status:'processing', shopList:sList, summary:{total:0, high:0, critical:0}, details:[] });
             sid = d.id;
             setSessionId(sid);
          } catch(e){}
      }
    }
    setProc(true); stopRef.current = false;
    setStat(p=>({...p, total:sList.length, sid}));
    addLog("🚀 一括パトロール開始");

    const BATCH = Math.min(config.apiKeys.length * 8, 40);

    for(let i=0; i<sList.length; i++) {
      if(stopRef.current) break;
      if(sList[i].status==='completed') continue;
      
      sList[i].status='processing';
      setStat(p=>({...p, cur:sList[i].url, done:i, shops:[...sList], currentShopItems:0, currentShopTotal:0})); 
      addLog(`[${i+1}/${sList.length}] ${sList[i].url} 開始`);
      
      let totalShopItems = 0;
      try {
          const u = new URL('/api/rakuten', window.location.origin);
          u.searchParams.append('shopUrl', sList[i].url);
          u.searchParams.append('appId', config.rakutenAppId);
          u.searchParams.append('page', 1);
          const r = await fetch(u);
          const d = await r.json();
          totalShopItems = d.count || 0;
          setStat(p=>({...p, currentShopTotal: totalShopItems}));
      } catch(e){}

      let p=1, shopI=[], hasN=true, processedInShop=0;
      
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
              if(!r.ok) throw new Error('Fetch Error');
              d = await r.json();
          } catch(fetchErr) { 
              addLog(`⚠️ ${sList[i].url} 取得エラー - 次へ`); 
              hasN = false; 
              break; 
          }

          if(!d.products?.length) { hasN=false; break; }
          
          for(let j=0; j<d.products.length; j+=BATCH) {
            if(stopRef.current) break;
            const b = d.products.slice(j, j+BATCH);
            const results = await Promise.all(b.map(async x => {
                try { return await analyzeItemRisk({productName:x.productName, imageUrl:x.imageUrl}, config.apiKeys); } catch(err) { return { risk_level: "エラー", reason: "解析失敗" }; }
            }));

            const res = b.map((x,k)=>({...x, ...results[k], shopUrl: sList[i].url}));
            shopI=[...shopI,...res];
            
            processedInShop += b.length;
            setStat(prev => ({...prev, currentShopItems: processedInShop, items: prev.items + b.length}));
          }
          
          if(p%5===0) { 
              sList[i].itemCount=shopI.length; 
              await save(sid, sList, {total:totalI+shopI.length, high:0, critical:0}); 
          }
          p++; if(p>300) { addLog("⚠️ ページ上限"); break; }
        }
        
        if(!stopRef.current) {
          sList[i].status='completed'; sList[i].itemCount=shopI.length; 
          setResultsMap(prev => ({...prev, [sList[i].url]: shopI}));
          const highRisks = shopI.filter(x=>x.risk_level==='高'||x.risk_level==='重大');
          await save(sid, sList, {total:stat.items, high:highRisks.length, critical:0}, highRisks);
          addLog(`✅ 完了: ${shopI.length}件`);
        }
      } catch(e){ sList[i].status='error'; addLog("❌ ショップエラー"); }
      
      setStat(prev => ({...prev, currentShopItems: totalShopItems, done: i+1}));
      await new Promise(r=>setTimeout(r, 500));
    }
    
    // 全停止でなければ継続
    if(stopRef.current) {
        addLog("一時停止しました");
        if(db && sid) await updateDoc(doc(db,'check_sessions',sid), {status:'paused', updatedAt:serverTimestamp()});
    } else {
        setProc(false);
        if(db && sid) await updateDoc(doc(db,'check_sessions',sid), {status:'completed', updatedAt:serverTimestamp()});
        addToast("全ショップ完了", "success");
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-500">
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg flex-shrink-0 relative overflow-hidden">
        <div className="flex justify-between mb-4 relative z-10">
          <div><h2 className="text-xl font-bold flex items-center gap-2"><Moon className="w-5 h-5 text-yellow-400"/> 一括夜間パトロール (Non-Stop)</h2></div>
          <div className="text-right"><div className="text-2xl font-bold font-mono text-blue-400">{stat.items.toLocaleString()}</div><div className="text-[10px] text-slate-400">チェック済み商品数</div></div>
        </div>
        
        {(proc || resume) && (
            <div className="mb-4 space-y-3">
                <ProgressBar current={stat.done} total={stat.total} label="ショップ消化率" color="bg-green-500" />
                <ProgressBar current={stat.currentShopItems} total={stat.currentShopTotal} label="現在のショップの進捗" color="bg-blue-500" />
            </div>
        )}

        {proc ? (
          <div className="bg-slate-800/80 backdrop-blur p-4 rounded-xl border border-slate-700 relative z-10">
            <div className="flex justify-between items-center mb-2"><span className="font-bold flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin text-blue-400"/> 処理中: {stat.shops[stat.done]?.url || "準備中..."}</span>
                <div className="flex gap-2">
                    <button onClick={()=>{setProc(false); stopRef.current=true;}} className="text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 px-3 py-1 rounded border border-amber-500/30 transition-colors">停止</button>
                </div>
            </div>
            <div className="h-24 overflow-y-auto font-mono text-[10px] text-green-400 bg-black/50 p-3 rounded-lg border border-white/5 custom-scrollbar">{logs.map((l,i)=><div key={i}>{l}</div>)}</div>
          </div>
        ) : (
          <div className="bg-slate-800/80 backdrop-blur p-4 rounded-xl border border-slate-700 relative z-10">
            <textarea value={urls} onChange={e=>setUrls(e.target.value)} disabled={!!resume} className="w-full h-32 bg-slate-900/50 border border-slate-600 rounded-lg p-3 text-xs text-slate-300 font-mono focus:outline-none focus:border-blue-500 transition-colors" placeholder={`https://www.rakuten.co.jp/shop-a/\nhttps://www.rakuten.co.jp/shop-b/\n...`} />
            <div className="mt-3 flex justify-between items-center">
              <p className="text-[10px] text-slate-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> 大量URL対応</p>
              <div className="flex gap-2">
                  {!resume ? (
                      <button onClick={run} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg shadow-blue-900/50 transition-all hover:translate-y-[-1px]"><PlayCircle className="w-4 h-4"/> 開始</button>
                  ) : (
                      <>
                        <button onClick={run} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg shadow-green-900/50 transition-all hover:translate-y-[-1px]"><PlayCircle className="w-4 h-4"/> 再開</button>
                        <button onClick={finish} className="bg-slate-600 hover:bg-slate-500 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg shadow-slate-900/50 transition-all hover:translate-y-[-1px]"><StopCircle className="w-4 h-4"/> 終了</button>
                      </>
                  )}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
            <h3 className="font-bold text-slate-700 text-sm flex gap-2 items-center"><List className="w-4 h-4"/> キューの状況</h3>
            <button onClick={dlAll} className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-slate-600 flex items-center gap-1"><Download className="w-3 h-3"/> 全データCSV出力</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {stat.shops.map((s,i)=><div key={i} className={`flex justify-between p-3 rounded-lg border text-xs transition-colors ${s.status==='processing'?'bg-blue-50 border-blue-200 shadow-sm':s.status==='completed'?'bg-white opacity-60 border-slate-100':'bg-slate-50 border-transparent'}`}><span className="truncate w-2/3 flex items-center gap-2">{s.status==='completed' && <CheckCircle className="w-3 h-3 text-green-500"/>} {s.url}</span><span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase ${s.status==='processing'?'text-blue-600 bg-blue-100':s.status==='completed'?'text-green-600 bg-green-100':'text-slate-400 bg-slate-200'}`}>{STATUS_MAP[s.status] || s.status} ({s.itemCount}件)</span></div>)}
        </div>
      </div>
    </div>
  );
};

const SettingsView = ({ config, setConfig, addToast, connectToFirebase }) => {
  const [k, setK] = useState(config.apiKeys.join('\n'));
  const [checking, setChecking] = useState(false);
  const [keyStatus, setKeyStatus] = useState({});
  const [showKey, setShowKey] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [rakutenLoading, setRakutenLoading] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if(textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [k]);

  const save = () => {
    const keys = k.split('\n').map(x=>x.trim()).filter(x=>x);
    setConfig({...config, apiKeys:keys, rakutenAppId:config.rakutenAppId, firebaseJson:config.firebaseJson});
    localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
    localStorage.setItem('rakuten_app_id', config.rakutenAppId);
    localStorage.setItem('firebase_config', config.firebaseJson);
    addToast("設定を保存しました", "success");
  };

  const handleDbToggle = async () => {
      setDbLoading(true);
      await connectToFirebase(config.firebaseJson);
      setDbLoading(false);
  };

  const handleRakutenCheck = async () => {
      setRakutenLoading(true);
      const res = await checkRakutenAppId(config.rakutenAppId);
      setRakutenLoading(false);
      if(res.ok) addToast("楽天AppIDは有効です", "success");
      else addToast(`エラー: ${res.msg}`, "error");
  };

  const checkKeys = async () => {
    const keys = k.split('\n').map(x=>x.trim()).filter(x=>x);
    if (keys.length === 0) return addToast("APIキーが入力されていません", "error");
    setChecking(true); setKeyStatus({});
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const res = await checkApiKeyHealth(key);
        setKeyStatus(prev => ({...prev, [i]: res}));
        await new Promise(r => setTimeout(r, 200)); 
    }
    setChecking(false); addToast("チェック完了", "success");
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-lg font-bold mb-6 flex items-center gap-2 pb-4 border-b"><Settings className="w-5 h-5"/> システム設定</h2>
      <div className="space-y-6">
        <div>
            <div className="flex justify-between items-end mb-1">
                <label className="text-xs font-bold text-slate-500 flex items-center gap-2">Gemini API Keys (1行に1つ) <button onClick={()=>setShowKey(!showKey)} className="text-slate-400 hover:text-blue-600 transition-colors">{showKey ? <EyeOff className="w-3 h-3"/> : <Eye className="w-3 h-3"/>}</button></label>
                <button onClick={checkKeys} disabled={checking} className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-slate-600 flex items-center gap-1 transition-colors">{checking ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>} 健全性チェック</button>
            </div>
            <div className="relative">
                <textarea ref={textareaRef} value={k} onChange={e=>setK(e.target.value)} className={`w-full p-3 border border-slate-200 rounded-lg min-h-[120px] text-xs font-mono focus:ring-2 focus:ring-slate-200 outline-none leading-loose overflow-hidden ${!showKey ? 'text-transparent' : ''}`} placeholder="Gemini APIキーを入力してください" style={{ caretColor: 'black' }} />
                {!showKey && (<div className="absolute inset-0 p-3 pointer-events-none text-xs font-mono leading-loose text-slate-800 bg-transparent select-none">{k ? k.split('\n').map((l, i) => <div key={i}>{'•'.repeat(Math.min(l.length, 40))}</div>) : ''}</div>)}
                <div className="absolute top-3 right-3 flex flex-col gap-2 pointer-events-none">{k.split('\n').map((_, i) => keyStatus[i] && (<div key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold flex items-center gap-1 shadow-sm ${keyStatus[i].ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{keyStatus[i].ok ? <Wifi className="w-3 h-3"/> : <WifiOff className="w-3 h-3"/>}{keyStatus[i].ok ? 'OK' : `ERR(${keyStatus[i].status})`}</div>))}</div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">※キーが多いほど並列処理数が上がり、高速化します。</p>
        </div>
        <div>
            <div className="flex justify-between items-end mb-1">
                <label className="text-xs font-bold text-slate-500">Rakuten App ID</label>
                <button onClick={handleRakutenCheck} disabled={rakutenLoading} className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded text-slate-600 flex items-center gap-1 transition-colors">{rakutenLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : <Check className="w-3 h-3"/>} 有効性チェック</button>
            </div>
            <input value={config.rakutenAppId} onChange={e=>setConfig({...config, rakutenAppId:e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-200 outline-none"/>
        </div>
        <div>
            <div className="flex justify-between items-end mb-1">
                <label className="text-xs font-bold text-slate-500">Firebase設定 (JSON)</label>
                <button onClick={handleDbToggle} disabled={dbLoading} className={`text-xs px-3 py-1 rounded flex items-center gap-1 transition-colors ${dbLoading ? 'bg-slate-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                    {dbLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : <Database className="w-3 h-3"/>} データベース接続
                </button>
            </div>
            <textarea value={config.firebaseJson} onChange={e=>setConfig({...config, firebaseJson:e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg h-24 text-xs font-mono focus:ring-2 focus:ring-slate-200 outline-none" placeholder='{"apiKey": "...", ...}'/>
        </div>
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
  
  const connectToFirebase = async (json) => {
      if(!json) return toast("設定JSONが空です", "error");
      try {
          const c = parseFirebaseConfig(json);
          if(!c) throw new Error("JSON形式エラー");
          
          if(getApps().length > 0) {
              const currentApp = getApp();
              await deleteApp(currentApp); 
          }
          
          const app = initializeApp(c);
          const firestore = getFirestore(app);
          setDb(firestore);
          setDbSt('OK');
          toast("データベースに接続しました", "success");
          
          // 修正: エラー時にhistをクリアしてホワイトアウト防止
          onSnapshot(query(collection(firestore,'check_sessions'), orderBy('createdAt','desc'), limit(20)), s => { 
              setHist(s.docs.map(d=>({id:d.id,...d.data()}))); 
          }, err => {
              console.error(err);
              setDbSt('ERR');
              setHist([]); // 安全策
              toast("DB接続エラー: 権限を確認してください", "error");
          });
      } catch(e) {
          console.error(e);
          setDbSt('ERR');
          toast(`接続失敗: ${e.message}`, "error");
      }
  };

  useEffect(() => {
    const k = JSON.parse(localStorage.getItem('gemini_api_keys')||'[]');
    const r = localStorage.getItem('rakuten_app_id')||'';
    const f = localStorage.getItem('firebase_config')||'';
    setConf({apiKeys:k, rakutenAppId:r, firebaseJson:f});
    if(localStorage.getItem('app_auth')==='true') setLogin(true);
    
    if(f) connectToFirebase(f);
    else setDbSt('No Config');
  }, []);

  if(!login) return <LoginView onLogin={async(p)=>{ if(p===APP_CONFIG.FIXED_PASSWORD){setLogin(true); localStorage.setItem('app_auth','true'); toast('ログイン成功', 'success');}else toast('パスワードが間違っています', 'error'); }}/>;

  const today = new Date().toLocaleDateString();
  const todayScans = hist.filter(h => {
      if(!h.createdAt) return false;
      try {
        const d = h.createdAt.toDate ? h.createdAt.toDate() : new Date(h.createdAt.seconds * 1000);
        return d.toLocaleDateString() === today;
      } catch(e) { return false; }
  });

  return (
    <div className="h-screen bg-slate-50 font-sans text-slate-800 flex flex-col overflow-hidden">
      <ToastContainer toasts={toasts} removeToast={id=>setToasts(p=>p.filter(t=>t.id!==id))} />
      <header className="bg-white border-b h-16 flex items-center justify-between px-6 sticky top-0 z-20 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2 font-bold text-lg text-slate-800"><div className="bg-slate-800 p-1.5 rounded-lg"><Gavel className="w-5 h-5 text-white"/></div> Rakuten Patrol Pro <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-2">v{APP_CONFIG.VERSION}</span></div>
        <div className="flex items-center gap-4 text-xs font-bold text-slate-500">
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${dbSt==='OK'?'bg-emerald-100 text-emerald-700':dbSt==='No Config'?'bg-slate-200 text-slate-600':'bg-amber-100 text-amber-700'}`}><div className={`w-2 h-2 rounded-full ${dbSt==='OK'?'bg-emerald-500':dbSt==='No Config'?'bg-slate-400':'bg-amber-500'}`}></div>DB: {dbSt==='OK'?'接続済み':dbSt==='No Config'?'未設定':'エラー'}</span>
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
          <div className="mt-auto bg-slate-50 p-4 rounded-xl border border-slate-100"><h4 className="font-bold text-xs text-slate-500 mb-2">システム状態</h4><div className="flex items-center gap-2 text-xs text-slate-400"><div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div> 全システム正常稼働中</div></div>
        </aside>
        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative bg-slate-50/50">
          {tab==='dashboard' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
              <div><h2 className="text-2xl font-bold text-slate-800 mb-1">お疲れ様です、管理者様</h2><p className="text-slate-500 text-sm">本日のパトロール状況とアラートの概要です。</p></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard title="本日のスキャン" value={todayScans.length} icon={Activity} color="bg-blue-500" subtext="件のセッション" onClick={() => setTab('history')} />
                <StatCard title="高リスク検知" value={hist.reduce((a,c)=>a+(c.summary?.critical||0),0)} icon={Siren} color="bg-red-500" subtext="直ちに対応が必要" onClick={() => setTab('history')} />
                <StatCard title="データベース接続" value={dbSt==='OK'?'OK':'-'} icon={Cloud} color={dbSt==='OK'?'bg-emerald-500':'bg-amber-500'} subtext={dbSt==='No Config'?'未接続':'接続完了'} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div onClick={()=>setTab('single')} className="bg-gradient-to-br from-blue-600 to-blue-700 p-8 rounded-2xl shadow-lg shadow-blue-200 text-white cursor-pointer hover:scale-[1.02] transition-transform relative overflow-hidden group"><ShoppingBag className="w-12 h-12 mb-4 text-white/80 group-hover:text-white transition-colors"/><h3 className="font-bold text-xl">通常パトロール</h3><p className="text-blue-100 text-sm mt-2 opacity-80">特定ショップをスキャン</p><ChevronRight className="absolute bottom-6 right-6 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0"/></div>
                  <div onClick={()=>{setRes(null);setTab('bulk');}} className="bg-gradient-to-br from-slate-800 to-slate-900 p-8 rounded-2xl shadow-lg shadow-slate-300 text-white cursor-pointer hover:scale-[1.02] transition-transform relative overflow-hidden group"><Moon className="w-12 h-12 mb-4 text-yellow-400"/><h3 className="font-bold text-xl">夜間一括モード</h3><p className="text-slate-400 text-sm mt-2">複数店舗を自動巡回</p><ChevronRight className="absolute bottom-6 right-6 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0"/></div>
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
                {hist.map(h=><div key={h.id} onClick={()=>{setIns(h);setTab('inspect');}} className="flex justify-between p-4 border border-slate-100 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors group"><div className="flex gap-4 items-center"><div className={`p-3 rounded-lg ${h.type==='bulk_url'?'bg-purple-100 text-purple-600':'bg-blue-100 text-blue-600'}`}>{h.type==='bulk_url'?<Layers className="w-5 h-5"/>:<ShoppingBag className="w-5 h-5"/>}</div><div><div className="truncate font-bold text-slate-800">{h.target}</div><div className="text-xs text-slate-400 mt-0.5">{formatDate(h.createdAt)}</div></div></div><div className="flex gap-3 items-center text-xs"><span className={`px-3 py-1 rounded-full font-bold ${h.status==='completed'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{STATUS_MAP[h.status] || h.status}</span>{(h.status==='paused'||h.status==='aborted')&&h.type==='bulk_url'&&<button onClick={(e)=>{e.stopPropagation();setRes(h);setTab('bulk');}} className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold">再開</button>}<ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500"/></div></div>)}
              </div>
            </div>
          )}
          {tab==='inspect' && ins && <div className="max-w-5xl mx-auto h-full"><ResultTable items={ins.details||[]} title={ins.target} onBack={()=>setTab('history')} /></div>}
          {tab==='settings' && <SettingsView config={conf} setConfig={setConf} addToast={toast} connectToFirebase={connectToFirebase} />}
        </main>
      </div>
    </div>
  );
}