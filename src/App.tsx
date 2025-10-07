import React, { useEffect, useMemo, useState } from "react";
import { db, fetchProducts, upsertProduct, removeProduct, addSale } from "./lib/firebase";

/** ========== Types ========== */
interface Product { id: number; name: string; price: number; category?: string; active?: boolean; }
interface CartItem { id: string; productId: number; name: string; price: number; qty: number; }
interface SaleRecord {
  id: string; time: string; timeMs: number; cashier: string;
  items: CartItem[]; subtotal: number; discount: number;
  taxRate: number; serviceRate: number; taxValue: number; serviceValue: number;
  total: number; payMethod: string; cash: number; change: number;
}
interface User { id: string; name: string; password: string; role: "admin" | "staff"; }

/** ========== Helpers/Constants ========== */
const IDR = (n: number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
const nowStr = () => new Date().toLocaleString("id-ID",{hour12:false});
const uid = () => Math.random().toString(36).slice(2,9).toUpperCase();
const toDateKey = (ms: number) => new Date(ms).toISOString().slice(0,10);

const PAY_METHODS = ["Tunai","QRIS","GoPay","OVO","DANA","Transfer"] as const;
const walletQR: Record<string,string> = {
  QRIS:"/qr-qris.png", GoPay:"/qr-qris.png", OVO:"/qr-qris.png", DANA:"/qr-qris.png", Transfer:"/qr-qris.png"
};

// Storage keys
const K_USERS="chafu.users.v1"; const K_USER="chafu.user.v1";
const K_PRODUCTS="chafu.products.v1"; const K_SALES="chafu.sales.v2";

// Defaults
const DEFAULT_USERS: User[] = [
  { id:"owner", name:"Owner", password:"12345", role:"admin" },
  { id:"kasir", name:"Kasir", password:"0000", role:"staff" },
];
const DEFAULT_PRODUCTS: Product[] = [
  { id:1, name:"Matcha OG", price:15000, category:"Signature", active:true },
  { id:2, name:"Matcha Cloud", price:18000, category:"Signature", active:true },
  { id:3, name:"Strawberry Cream Matcha", price:17000, category:"Signature", active:true },
  { id:4, name:"Choco Matcha", price:17000, category:"Signature", active:true },
  { id:5, name:"Matcha Cookies", price:17000, category:"Signature", active:true },
  { id:6, name:"Honey Matcha", price:18000, category:"Signature", active:true },
  { id:7, name:"Coconut Matcha", price:18000, category:"Signature", active:true },
  { id:8, name:"Orange Matcha", price:17000, category:"Signature", active:true },
];

/** ========== Small UI helpers ========== */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({title,children}) => (
  <section style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:14}}>
    <h2 style={{marginTop:0}}>{title}</h2>{children}
  </section>
);
const StatCard: React.FC<{ label:string; value:string|number }> = ({label,value}) => (
  <div style={{border:"1px solid #eee",borderRadius:10,padding:12}}>
    <div style={{fontSize:12,color:"#666"}}>{label}</div>
    <div style={{fontSize:18,fontWeight:700}}>{value}</div>
  </div>
);

/** ========== Login ========== */
const LoginView: React.FC<{ users:User[]; onLogin:(u:{id:string;name:string;role:"admin"|"staff"})=>void; }> = ({users,onLogin})=>{
  const [uidText,setUidText]=useState(""); const [pwd,setPwd]=useState(""); const [err,setErr]=useState("");
  const handleLogin=()=>{ const u=users.find(x=>x.id===uidText && x.password===pwd); if(!u){setErr("User ID atau password salah");return;} onLogin({id:u.id,name:u.name,role:u.role}); };
  return (
    <div style={{fontFamily:"Poppins, sans-serif",display:"grid",placeItems:"center",height:"100vh",background:"#e8f5e9"}}>
      <div style={{background:"#fff",padding:30,borderRadius:16,boxShadow:"0 4px 12px rgba(0,0,0,.1)",width:320,textAlign:"center"}}>
        <h2 style={{color:"#2e7d32",marginTop:0}}>🍵 CHAFU MATCHA POS</h2>
        <p style={{fontSize:13,color:"#777",marginTop:-6,marginBottom:12}}>Login untuk melanjutkan</p>
        <input placeholder="User ID" value={uidText} onChange={e=>setUidText(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1px solid #ccc",borderRadius:8,marginBottom:8}}/>
        <input type="password" placeholder="Password" value={pwd} onChange={e=>setPwd(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1px solid #ccc",borderRadius:8,marginBottom:8}}/>
        {err && <div style={{color:"crimson",fontSize:12,marginBottom:8}}>{err}</div>}
        <button onClick={handleLogin} style={{background:"#2e7d32",color:"#fff",padding:"8px 14px",border:"none",borderRadius:8,cursor:"pointer",width:"100%"}}>Login</button>
      </div>
    </div>
  );
};

/** ========== Product Manager ========== */
const ProductManager: React.FC<{
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
}> = ({ products, setProducts }) => {
  const [form,setForm]=useState<Product>({ id:Date.now(), name:"", price:0, category:"Signature", active:true });
  const [editingId,setEditingId]=useState<number|null>(null);

  const save = async () => {
    if(!form.name.trim() || form.price<=0){ alert("Nama & harga wajib diisi"); return; }
    const id = editingId ?? (Math.max(0,...products.map(p=>p.id))+1);
    const payload = { id, name:form.name, price:form.price, category:form.category, active:form.active };
    if(editingId!==null){ setProducts(prev=>prev.map(x=>x.id===editingId?payload:x)); }
    else{ setProducts(prev=>[...prev,payload]); }
    try{ await upsertProduct(payload); }catch(e){ console.log("⚠️ Firestore upsert failed:",e); }
    setEditingId(null); setForm({ id:Date.now(), name:"", price:0, category:"Signature", active:true });
  };

  const del = async (id:number) => {
    if(!confirm("Hapus produk ini?")) return;
    setProducts(prev=>prev.filter(x=>x.id!==id));
    try{ await removeProduct(id); }catch(e){ console.log("⚠️ Firestore delete failed:",e); }
  };

  return (
    <div style={{display:"grid",gap:10}}>
      <div style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",gap:8}}>
        <span>Nama</span><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={{padding:"8px 10px",border:"1px solid #ddd",borderRadius:8}}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",gap:8}}>
        <span>Kategori</span><input value={form.category||""} onChange={e=>setForm({...form,category:e.target.value})} style={{padding:"8px 10px",border:"1px solid #ddd",borderRadius:8}}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",gap:8}}>
        <span>Harga (Rp)</span><input type="number" value={form.price} onChange={e=>setForm({...form,price:parseInt(e.target.value)||0})} style={{padding:"8px 10px",border:"1px solid #ddd",borderRadius:8}}/>
      </div>
      <label><input type="checkbox" checked={form.active!==false} onChange={e=>setForm({...form,active:e.target.checked})}/> Aktif</label>
      <div style={{display:"flex",gap:8}}>
        <button onClick={save} style={{padding:"8px 12px",borderRadius:8,border:"none",background:"#2e7d32",color:"#fff",cursor:"pointer"}}>{editingId!==null?"Simpan Perubahan":"Tambah Produk"}</button>
        {editingId!==null && <button onClick={()=>{setEditingId(null);setForm({ id:Date.now(), name:"", price:0, category:"Signature", active:true });}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",background:"#fff",cursor:"pointer"}}>Batal</button>}
      </div>

      <div style={{overflowX:"auto",marginTop:8}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{background:"#2e7d32",color:"#fff"}}>
              <th style={{textAlign:"left",padding:6}}>Nama</th>
              <th style={{textAlign:"left",padding:6}}>Kategori</th>
              <th style={{textAlign:"left",padding:6}}>Harga</th>
              <th style={{textAlign:"left",padding:6}}>Aktif</th>
              <th style={{width:140,padding:6}}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p=>(
              <tr key={p.id}>
                <td style={{padding:6}}>{p.name}</td>
                <td style={{padding:6}}>{p.category||"-"}</td>
                <td style={{padding:6}}>{IDR(p.price)}</td>
                <td style={{padding:6}}>
                  <input type="checkbox" checked={p.active!==false}
                    onChange={e=>setProducts(prev=>prev.map(x=>x.id===p.id?{...x,active:e.target.checked}:x))}/>
                </td>
                <td style={{padding:6}}>
                  <button onClick={()=>{setEditingId(p.id);setForm({...p});}} style={{padding:"6px 10px",marginRight:6,borderRadius:8,border:"1px solid #ddd",background:"#fff",cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>del(p.id)} style={{padding:"6px 10px",borderRadius:8,border:"none",background:"#c62828",color:"#fff",cursor:"pointer"}}>Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** ========== Print Receipt ========== */
function printReceipt(rec: SaleRecord){
  const w=window.open("","_blank","width=380,height=600"); if(!w) return;
  const itemsHtml=rec.items.map(i=>`<tr><td>${i.name}</td><td style="text-align:center">${i.qty}x</td><td style="text-align:right">${IDR(i.price*i.qty)}</td></tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Struk</title>
  <style>body{font-family:ui-monospace,Menlo,Consolas,monospace}.wrap{width:280px;margin:0 auto}h2{text-align:center;margin:8px 0}
  table{width:100%;border-collapse:collapse}td{padding:4px 0;border-bottom:1px dashed #ddd;font-size:12px}
  .tot td{border-bottom:none;font-weight:700}.meta{font-size:12px;text-align:center;opacity:.8}</style></head><body>
  <div class="wrap"><h2>CHAFU MATCHA</h2><div class="meta">${rec.id}<br/>${rec.time}</div>
  <div class="meta">Kasir: ${rec.cashier} • Metode: ${rec.payMethod}</div><hr/><table>${itemsHtml}
  <tr class="tot"><td>Subtotal</td><td></td><td style="text-align:right">${IDR(rec.subtotal)}</td></tr>
  ${rec.taxValue?`<tr class="tot"><td>Pajak (${rec.taxRate}%)</td><td></td><td style="text-align:right">${IDR(rec.taxValue)}</td></tr>`:""}
  ${rec.serviceValue?`<tr class="tot"><td>Service (${rec.serviceRate}%)</td><td></td><td style="text-align:right">${IDR(rec.serviceValue)}</td></tr>`:""}
  ${rec.discount?`<tr class="tot"><td>Diskon</td><td></td><td style="text-align:right">-${IDR(rec.discount)}</td></tr>`:""}
  <tr class="tot"><td>Total</td><td></td><td style="text-align:right">${IDR(rec.total)}</td></tr>
  <tr><td>Dibayar</td><td></td><td style="text-align:right">${IDR(rec.cash)}</td></tr>
  <tr><td>Kembali</td><td></td><td style="text-align:right">${IDR(rec.change)}</td></tr></table>
  <p class="meta">Terima kasih! Follow @chafumatcha</p></div><script>window.print()</script></body></html>`;
  w.document.write(html); w.document.close();
}

/** ========== Main App ========== */
export default function App(){
  // Users & session
  const [users,setUsers]=useState<User[]>(()=>{ try{ const s=JSON.parse(localStorage.getItem(K_USERS)||"null"); if(s) return s; localStorage.setItem(K_USERS,JSON.stringify(DEFAULT_USERS)); return DEFAULT_USERS; }catch{ localStorage.setItem(K_USERS,JSON.stringify(DEFAULT_USERS)); return DEFAULT_USERS; } });
  const [user,setUser]=useState<{id:string;name:string;role:"admin"|"staff"}|null>(()=>{ try{ return JSON.parse(localStorage.getItem(K_USER)||"null"); }catch{return null;} });
  useEffect(()=>{ if(user) localStorage.setItem(K_USER,JSON.stringify(user)); },[user]);
  const [showChangePass,setShowChangePass]=useState(false); const [oldPass,setOldPass]=useState(""); const [newPass,setNewPass]=useState("");

  // Products
  const [products,setProducts]=useState<Product[]>(()=>{ try{ const s=JSON.parse(localStorage.getItem(K_PRODUCTS)||"null"); if(s&&s.length) return s; localStorage.setItem(K_PRODUCTS,JSON.stringify(DEFAULT_PRODUCTS)); return DEFAULT_PRODUCTS; }catch{ localStorage.setItem(K_PRODUCTS,JSON.stringify(DEFAULT_PRODUCTS)); return DEFAULT_PRODUCTS; } });
  useEffect(()=>{ localStorage.setItem(K_PRODUCTS,JSON.stringify(products)); },[products]);

  // 🔄 sinkron awal dari Firestore (jika ada)
  useEffect(()=>{ (async()=>{ try{ const cloud=await fetchProducts(); if(cloud && cloud.length){ setProducts(cloud as any); localStorage.setItem(K_PRODUCTS,JSON.stringify(cloud)); } }catch(e){ console.log("⚠️ fetchProducts fail:",e); } })(); },[]);

  // Sales
  const [sales,setSales]=useState<SaleRecord[]>(()=>{ try{ return JSON.parse(localStorage.getItem(K_SALES)||"[]"); }catch{return [];} });
  useEffect(()=>{ localStorage.setItem(K_SALES,JSON.stringify(sales)); },[sales]);

  // POS State
  const [tab,setTab]=useState<"pos"|"history"|"dashboard"|"products">("pos");
  const [cart,setCart]=useState<CartItem[]>([]);
  const [payMethod,setPayMethod]=useState<string>("Tunai");
  const [cash,setCash]=useState<number>(0);
  const [discount,setDiscount]=useState<number>(0);
  const [taxRate,setTaxRate]=useState<number>(0);
  const [serviceRate,setServiceRate]=useState<number>(0);
  const [useTax,setUseTax]=useState<boolean>(false);
  const [useService,setUseService]=useState<boolean>(false);
  const [query,setQuery]=useState<string>("");
  const [showQR,setShowQR]=useState<boolean>(false);

  const filteredProducts=useMemo(()=>products.filter(p=>(p.active!==false)&&p.name.toLowerCase().includes(query.toLowerCase())),[products,query]);
  const subtotal=useMemo(()=>cart.reduce((s,i)=>s+i.price*i.qty,0),[cart]);
  const taxValue=useMemo(()=>useTax?Math.round(subtotal*(taxRate/100)):0,[useTax,subtotal,taxRate]);
  const serviceValue=useMemo(()=>useService?Math.round(subtotal*(serviceRate/100)):0,[useService,subtotal,serviceRate]);
  const total=Math.max(0,subtotal+taxValue+serviceValue-(discount||0));
  const actualPaid=payMethod==="Tunai"?(cash||0):total;
  const change=Math.max(0,actualPaid-total);

  const addToCart=(p:Product)=>setCart(prev=>{ const f=prev.find(x=>x.productId===p.id); if(f) return prev.map(x=>x.id===f.id?{...x,qty:x.qty+1}:x); return [...prev,{ id:uid(), productId:p.id, name:p.name, price:p.price, qty:1 }]; });
  const inc=(id:string)=>setCart(prev=>prev.map(x=>x.id===id?{...x,qty:x.qty+1}:x));
  const dec=(id:string)=>setCart(prev=>prev.map(x=>x.id===id?{...x,qty:Math.max(1,x.qty-1)}:x));
  const rm=(id:string)=>setCart(prev=>prev.filter(x=>x.id!==id));
  const clearCart=()=>{ setCart([]); setDiscount(0); setUseTax(false); setUseService(false); setCash(0); setPayMethod("Tunai"); setShowQR(false); };

  const finalize=async()=>{ if(!user){alert("Silakan login dahulu.");return;} if(cart.length===0){alert("Keranjang kosong.");return;} if(total<=0){alert("Total tidak valid.");return;} if(payMethod==="Tunai" && actualPaid<total){alert("Tunai kurang.");return;}
    const rec:SaleRecord={ id:`CM-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,"0")}-${uid()}`, time:nowStr(), timeMs:Date.now(), cashier:user.name, items:cart, subtotal, discount:discount||0, taxRate:useTax?taxRate:0, serviceRate:useService?serviceRate:0, taxValue, serviceValue, total, payMethod, cash:actualPaid, change };
    setSales(prev=>[rec,...prev]);
    try{ await addSale(rec); }catch(e){ console.log("⚠️ addSale cloud fail:",e); }
    printReceipt(rec); clearCart(); alert(`Transaksi tersimpan!\nID: ${rec.id}\nTotal: ${IDR(rec.total)}\nKembali: ${IDR(rec.change)}`); setTab("history");
  };

  // Dashboard stats
  const todayKey=toDateKey(Date.now());
  const withKey=sales.map(s=>({...s,key:toDateKey(s.timeMs)}));
  const todaySales=withKey.filter(s=>s.key===todayKey);
  const omzetToday=todaySales.reduce((a,b)=>a+b.total,0);
  const trxToday=todaySales.length;
  const aovToday=trxToday?Math.round(omzetToday/trxToday):0;
  const topMap:Record<string,number>={}; todaySales.forEach(s=>s.items.forEach(i=>{topMap[i.name]=(topMap[i.name]||0)+i.qty;}));
  const topItems=Object.entries(topMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const last14=Array.from({length:14}).map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(13-i)); const k=toDateKey(d.getTime()); const ds=withKey.filter(s=>s.key===k); return { date:k, trx:ds.length, omzet:ds.reduce((a,b)=>a+b.total,0) }; });

  // Login screen
  if(!user) return <LoginView users={users} onLogin={(u)=>setUser(u)} />;

  return (
    <div style={{fontFamily:"Poppins, system-ui, sans-serif",background:"#f6f7f6",minHeight:"100vh"}}>
      <header style={{padding:"16px 20px",borderBottom:"2px solid #2e7d32",display:"flex",gap:12,alignItems:"center",justifyContent:"space-between"}}>
        <div><h1 style={{color:"#2e7d32",margin:0}}>🍵 CHAFU MATCHA POS</h1><div style={{color:"#666",fontSize:12}}>Modern Ritual — ketenangan di setiap gelas</div></div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setTab("pos")} style={{padding:"8px 12px",borderRadius:8,border:tab==="pos"?"2px solid #2e7d32":"1px solid #ddd",background:"#fff",cursor:"pointer"}}>Kasir</button>
          <button onClick={()=>setTab("history")} style={{padding:"8px 12px",borderRadius:8,border:tab==="history"?"2px solid #2e7d32":"1px solid #ddd",background:"#fff",cursor:"pointer"}}>Riwayat</button>
          {user.role==="admin" && <>
            <button onClick={()=>setTab("products")} style={{padding:"8px 12px",borderRadius:8,border:tab==="products"?"2px solid #2e7d32":"1px solid #ddd",background:"#fff",cursor:"pointer"}}>Produk</button>
            <button onClick={()=>setTab("dashboard")} style={{padding:"8px 12px",borderRadius:8,border:tab==="dashboard"?"2px solid #2e7d32":"1px solid #ddd",background:"#fff",cursor:"pointer"}}>Dashboard</button>
          </>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:13,color:"#333"}}>👤 {user.name} ({user.role})</span>
          <button onClick={()=>setShowChangePass(true)} style={{background:"#fbc02d",color:"#333",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>Ganti Password</button>
          <button onClick={()=>{localStorage.removeItem(K_USER);setUser(null);}} style={{background:"#c62828",color:"#fff",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>Logout</button>
        </div>
      </header>

      {tab==="pos" && (
        <main style={{padding:20,display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,maxWidth:1200,margin:"0 auto"}}>
          <Section title="Menu Minuman">
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <input placeholder="Cari menu…" value={query} onChange={e=>setQuery(e.target.value)} style={{flex:1,padding:"8px 10px",border:"1px solid #ddd",borderRadius:8}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {filteredProducts.map(p=>(
                <button key={p.id} onClick={()=>addToCart(p)} style={{padding:12,borderRadius:10,border:"1px solid #ddd",background:"#fff",textAlign:"left",cursor:"pointer"}}>
                  <strong>{p.name}</strong><br/><span>{IDR(p.price)}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Keranjang">
            {cart.length===0 ? <p style={{color:"#777"}}>Belum ada item.</p> : (
              <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10}}>
                <thead><tr style={{background:"#2e7d32",color:"#fff"}}><th style={{textAlign:"left",padding:6}}>Produk</th><th style={{textAlign:"left",padding:6,width:80}}>Qty</th><th style={{textAlign:"left",padding:6}}>Harga</th><th style={{width:40}}/></tr></thead>
                <tbody>{cart.map(it=>(
                  <tr key={it.id}>
                    <td style={{padding:6}}>{it.name}</td>
                    <td style={{padding:6}}>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <button onClick={()=>dec(it.id)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #ddd",cursor:"pointer"}}>−</button>
                        <span style={{minWidth:16,textAlign:"center"}}>{it.qty}</span>
                        <button onClick={()=>inc(it.id)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #ddd",cursor:"pointer"}}>+</button>
                      </div>
                    </td>
                    <td style={{padding:6}}>{IDR(it.price*it.qty)}</td>
                    <td style={{padding:6}}><button onClick={()=>rm(it.id)} style={{background:"none",border:"none",color:"crimson",cursor:"pointer",fontSize:18}}>✖</button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <hr/>
            <div style={{display:"grid",gap:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><label><input type="checkbox" checked={useTax} onChange={e=>setUseTax(e.target.checked)}/> Pajak (%)</label><input type="number" value={taxRate} onChange={e=>setTaxRate(parseFloat(e.target.value)||0)} style={{width:90}}/></div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><label><input type="checkbox" checked={useService} onChange={e=>setUseService(e.target.checked)}/> Service (%)</label><input type="number" value={serviceRate} onChange={e=>setServiceRate(parseFloat(e.target.value)||0)} style={{width:90}}/></div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>Diskon (Rp)</span><input type="number" value={discount} onChange={e=>setDiscount(parseInt(e.target.value)||0)} style={{width:140}}/></div>
            </div>
            <div style={{marginTop:10}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Subtotal</span><strong>{IDR(subtotal)}</strong></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Pajak</span><span>{IDR(taxValue)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Service</span><span>{IDR(serviceValue)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Diskon</span><span>-{IDR(discount)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,marginTop:6}}><span>Total</span><span>{IDR(total)}</span></div>
            </div>
            <div style={{display:"grid",gap:8,marginTop:10}}>
              <div style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",gap:8}}>
                <span>Metode Bayar</span>
                <select value={payMethod} onChange={e=>{const v=e.target.value; setPayMethod(v); if(v!=="Tunai") setShowQR(true);}} style={{padding:"8px 10px",border:"1px solid #ddd",borderRadius:8}}>
                  {PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {payMethod==="Tunai" && (
                <div style={{display:"grid",gridTemplateColumns:"120px 1fr",alignItems:"center",gap:8}}>
                  <span>Tunai</span><input type="number" value={cash} onChange={e=>setCash(parseInt(e.target.value)||0)} style={{padding:"8px 10px",border:"1px solid #ddd",borderRadius:8}}/>
                </div>
              )}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>Kembali</span><span style={{fontWeight:600,color:change<0?"crimson":"#2e7d32"}}>{IDR(change)}</span></div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:12}}>
              <button onClick={clearCart} style={{background:"#9e9e9e",color:"#fff",padding:"10px 18px",borderRadius:8,border:"none",cursor:"pointer"}}>Bersihkan</button>
              <button onClick={finalize} disabled={cart.length===0||total<=0||(payMethod==="Tunai"&&actualPaid<total)} style={{background:"#2e7d32",color:"#fff",padding:"10px 18px",borderRadius:8,border:"none",cursor:"pointer",opacity:(cart.length===0||total<=0||(payMethod==="Tunai"&&actualPaid<total))?0.6:1}}>Selesaikan & Cetak</button>
            </div>
          </Section>
        </main>
      )}

      {tab==="history" && (
        <main style={{padding:20,maxWidth:1200,margin:"0 auto",display:"grid",gap:20}}>
          <Section title="Riwayat Transaksi">
            {sales.length===0 ? <p style={{color:"#777"}}>Belum ada transaksi.</p> : (
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{background:"#2e7d32",color:"#fff"}}><th style={{textAlign:"left",padding:6}}>Waktu</th><th style={{textAlign:"left",padding:6}}>ID</th><th style={{textAlign:"left",padding:6}}>Kasir</th><th style={{textAlign:"left",padding:6}}>Metode</th><th style={{textAlign:"left",padding:6}}>Item</th><th style={{textAlign:"left",padding:6}}>Total</th><th style={{width:100,padding:6}}>Aksi</th></tr></thead>
                  <tbody>{sales.map(s=>(
                    <tr key={s.id}>
                      <td style={{padding:6}}>{s.time}</td>
                      <td style={{padding:6}}>{s.id}</td>
                      <td style={{padding:6}}>{s.cashier}</td>
                      <td style={{padding:6}}>{s.payMethod}</td>
                      <td style={{padding:6}}>{s.items.map(i=>`${i.name} x${i.qty}`).join(", ")}</td>
                      <td style={{padding:6}}>{IDR(s.total)}</td>
                      <td style={{padding:6}}><button onClick={()=>printReceipt(s)} style={{background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>Cetak</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div style={{marginTop:12,display:"flex",gap:8}}>
              <button onClick={()=>{ const rows=[["ID","Waktu","Kasir","Metode","Items (qty)","Subtotal","Diskon","Pajak%","Service%","Pajak Rp","Service Rp","Total","Dibayar","Kembali"], ...sales.map(s=>[s.id,s.time,s.cashier,s.payMethod,s.items.map(i=>`${i.name} x${i.qty}`).join("; "),String(s.subtotal),String(s.discount),String(s.taxRate),String(s.serviceRate),String(s.taxValue),String(s.serviceValue),String(s.total),String(s.cash),String(s.change)])]; const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n"); const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`chafu_sales_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url); }} style={{background:"#2e7d32",color:"#fff",padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer"}}>Export CSV</button>
              {user.role==="admin" && <button onClick={()=>{ if(confirm("Hapus semua riwayat?")) setSales([]); }} style={{background:"#c62828",color:"#fff",padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer"}}>Hapus Semua</button>}
            </div>
          </Section>
        </main>
      )}

      {user.role==="admin" && tab==="products" && (
        <main style={{padding:20,maxWidth:1000,margin:"0 auto",display:"grid",gap:20}}>
          <Section title="Manajemen Produk"><ProductManager products={products} setProducts={setProducts}/></Section>
        </main>
      )}

      {user.role==="admin" && tab==="dashboard" && (
        <main style={{padding:20,maxWidth:1200,margin:"0 auto",display:"grid",gap:20}}>
          <Section title="Ringkasan Hari Ini">
            <div style={{display:"grid",gridTemplateColumns:"repeat(4, 1fr)",gap:10}}>
              <StatCard label="Omzet" value={IDR(omzetToday)} />
              <StatCard label="Transaksi" value={trxToday} />
              <StatCard label="AOV" value={IDR(aovToday)} />
              <StatCard label="Terlaris" value={topItems.length?`${topItems[0][0]} (${topItems[0][1]})`:"-"} />
            </div>
          </Section>
          <Section title="14 Hari Terakhir">
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:"#2e7d32",color:"#fff"}}><th style={{textAlign:"left",padding:6}}>Tanggal</th><th style={{textAlign:"left",padding:6}}>Transaksi</th><th style={{textAlign:"left",padding:6}}>Omzet</th></tr></thead>
                <tbody>{last14.map(d=>(
                  <tr key={d.date}><td style={{padding:6}}>{d.date}</td><td style={{padding:6}}>{d.trx}</td><td style={{padding:6}}>{IDR(d.omzet)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Section>
        </main>
      )}

      {showQR && payMethod!=="Tunai" && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"grid",placeItems:"center",zIndex:50}}>
          <div style={{background:"#fff",padding:16,borderRadius:12,width:340,textAlign:"center",boxShadow:"0 10px 30px rgba(0,0,0,.15)"}}>
            <h3 style={{marginTop:0}}>Scan {payMethod}</h3>
            <img src={walletQR[payMethod]||walletQR.QRIS} alt={`QR ${payMethod}`} style={{width:260,height:260,objectFit:"contain",border:"1px solid #eee",borderRadius:8}}/>
            <p style={{fontSize:12,color:"#555"}}>Nominal: <b>{IDR(total)}</b></p>
            <div style={{display:"flex",gap:8,justifyContent:"center"}}>
              <button onClick={()=>setShowQR(false)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",background:"#fff",cursor:"pointer"}}>Tutup</button>
              <button onClick={()=>setShowQR(false)} style={{padding:"8px 12px",borderRadius:8,border:"none",background:"#2e7d32",color:"#fff",cursor:"pointer"}}>Sudah Dibayar</button>
            </div>
          </div>
        </div>
      )}

      {showChangePass && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",display:"grid",placeItems:"center",zIndex:100}}>
          <div style={{background:"#fff",padding:20,borderRadius:12,width:320,textAlign:"center"}}>
            <h3 style={{marginTop:0}}>Ubah Password</h3>
            <input type="password" placeholder="Password Lama" value={oldPass} onChange={e=>setOldPass(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1px solid #ccc",borderRadius:8,marginBottom:8}}/>
            <input type="password" placeholder="Password Baru" value={newPass} onChange={e=>setNewPass(e.target.value)} style={{width:"100%",padding:"8px 10px",border:"1px solid #ccc",borderRadius:8,marginBottom:8}}/>
            <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:10}}>
              <button onClick={()=>{ if(!oldPass||!newPass) return alert("Isi semua kolom"); const idx=users.findIndex(u=>u.id===user.id); if(idx<0) return alert("User tidak ditemukan"); if(users[idx].password!==oldPass) return alert("Password lama salah"); const updated=[...users]; updated[idx]={...users[idx],password:newPass}; setUsers(updated); localStorage.setItem(K_USERS,JSON.stringify(updated)); setOldPass(""); setNewPass(""); setShowChangePass(false); alert("Password berhasil diubah!"); }} style={{background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,padding:"8px 12px"}}>Simpan</button>
              <button onClick={()=>{setShowChangePass(false);setOldPass("");setNewPass("");}} style={{border:"1px solid #ddd",borderRadius:8,padding:"8px 12px"}}>Batal</button>
            </div>
          </div>
        </div>
      )}

      <footer style={{textAlign:"center",margin:"18px 0 30px",color:"#555",fontSize:13}}>© {new Date().getFullYear()} CHAFU MATCHA — Modern Ritual.</footer>
    </div>
  );
}
