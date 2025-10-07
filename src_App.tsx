
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Minus, Trash2, Settings, Printer, Download, CreditCard, Search, History, Wand2 } from "lucide-react";
import { motion } from "framer-motion";

const IDR = (n:number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
const nowStr = () => new Date().toLocaleString("id-ID", { hour12:false });
const uid = () => Math.random().toString(36).slice(2,9);

interface Product { id: string; name: string; price: number; category: string; active?: boolean; }
interface SizeOption { id: string; name: string; delta: number; }
interface Topping { id: string; name: string; price: number; }
interface CartItem { id: string; productId: string; name: string; price: number; qty: number; note?: string; sizeId?: string; toppingIds?: string[]; }
interface SaleRecord { id: string; time: string; timeMs: number; items: CartItem[]; subtotal: number; discount: number; taxRate: number; service: number; total: number; cash: number; change: number; payMethod?: string; }
interface SettingsData { shopName: string; taxRate: number; service: number; }

const DEFAULT_PRODUCTS: Product[] = [
  { id: uid(), name: "Matcha OG", price: 15000, category: "Signature", active: true },
  { id: uid(), name: "Matcha Cloud", price: 18000, category: "Signature", active: true },
  { id: uid(), name: "Strawberry Cream Matcha", price: 17000, category: "Signature", active: true },
  { id: uid(), name: "Choco Matcha", price: 17000, category: "Signature", active: true },
  { id: uid(), name: "Matcha Cookies", price: 17000, category: "Signature", active: true },
  { id: uid(), name: "Honey Matcha", price: 18000, category: "Signature", active: true },
  { id: uid(), name: "Coconut Matcha", price: 18000, category: "Signature", active: true },
  { id: uid(), name: "Orange Matcha", price: 17000, category: "Signature", active: true },
];

const SIZE_OPTIONS: SizeOption[] = [
  { id: "R", name: "Regular", delta: 0 },
  { id: "L", name: "Large", delta: 3000 },
];

const TOPPINGS: Topping[] = [
  { id: "boba", name: "Boba", price: 3000 },
  { id: "cream", name: "Cream", price: 3000 },
  { id: "coco", name: "Coco Jelly", price: 3000 },
];

const DEFAULT_SETTINGS: SettingsData = { shopName: "CHAFU MATCHA", taxRate: 0, service: 0 };
const K_PRODUCTS = "kasir.products.v2";
const K_SETTINGS = "kasir.settings.v1";
const K_SALES    = "kasir.sales.v2";

export default function App(){
  const [products, setProducts] = useState<Product[]>(() => {
    const s = localStorage.getItem(K_PRODUCTS); return s ? JSON.parse(s) : DEFAULT_PRODUCTS;
  });
  const [settings, setSettings] = useState<SettingsData>(() => {
    const s = localStorage.getItem(K_SETTINGS); return s ? JSON.parse(s) : DEFAULT_SETTINGS;
  });
  const [sales, setSales] = useState<SaleRecord[]>(() => {
    const s = localStorage.getItem(K_SALES); return s ? JSON.parse(s) : [];
  });

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [payOpen, setPayOpen] = useState(false);
  const [cash, setCash] = useState<number>(0);
  const [note, setNote] = useState<string>("");
  const [includeTax, setIncludeTax] = useState<boolean>(false);
  const [includeService, setIncludeService] = useState<boolean>(false);

  const [customOpen, setCustomOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product|null>(null);
  const [selSize, setSelSize] = useState<string>(SIZE_OPTIONS[0].id);
  const [selToppings, setSelToppings] = useState<string[]>([]);
  const [itemNote, setItemNote] = useState<string>("");

  const PAY_METHODS = ["Tunai","QRIS","GoPay","OVO","DANA","Transfer"] as const;
  const [payMethod, setPayMethod] = useState<string>("Tunai");

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState<boolean>(false);

  useEffect(()=> localStorage.setItem(K_PRODUCTS, JSON.stringify(products)), [products]);
  useEffect(()=> localStorage.setItem(K_SETTINGS, JSON.stringify(settings)), [settings]);
  useEffect(()=> localStorage.setItem(K_SALES, JSON.stringify(sales)), [sales]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.warn);
    }
    const beforeInstall = (e: any) => { e.preventDefault(); setDeferredPrompt(e); setCanInstall(true); };
    const onInstalled = () => setCanInstall(false);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(products.map(p=>p.category)))], [products]);

  const filtered = useMemo(()=> products.filter(p => (p.active!==false) &&
    (categoryFilter==="All" || p.category===categoryFilter) &&
    (p.name.toLowerCase().includes(query.toLowerCase()))
  ), [products, categoryFilter, query]);

  const subtotal = useMemo(()=> cart.reduce((s,i)=> s + i.price * i.qty, 0), [cart]);
  const tax = useMemo(()=> includeTax ? Math.round(subtotal * (settings.taxRate/100)) : 0, [includeTax, subtotal, settings.taxRate]);
  const service = useMemo(()=> includeService ? Math.round(subtotal * (settings.service/100)) : 0, [includeService, subtotal, settings.service]);
  const total = Math.max(0, subtotal + tax + service - (discount||0));
  const change = useMemo(()=> Math.max(0, (payMethod==="Tunai" ? (cash||0) : total) - total), [payMethod, cash, total]);

  const openCustomize = (p: Product) => {
    setSelectedProduct(p);
    setSelSize(SIZE_OPTIONS[0].id);
    setSelToppings([]);
    setItemNote(note);
    setCustomOpen(true);
  };

  const addCustomizedToCart = () => {
    if(!selectedProduct) return;
    const sizeObj = SIZE_OPTIONS.find(s=>s.id===selSize)!;
    const toppingsObjs = TOPPINGS.filter(t=>selToppings.includes(t.id));
    const unitPrice = selectedProduct.price + sizeObj.delta + toppingsObjs.reduce((s,t)=>s+t.price,0);
    const displayName = `${selectedProduct.name} (${sizeObj.name}${toppingsObjs.length?`, +${toppingsObjs.map(t=>t.name).join("/")}`:``})`;
    setCart(prev => {
      const found = prev.find(ci => ci.productId===selectedProduct.id && (ci.note||"") === (itemNote||"") && ci.sizeId===selSize && JSON.stringify(ci.toppingIds||[])===JSON.stringify(selToppings));
      if(found){ return prev.map(ci => ci===found ? { ...ci, qty: ci.qty+1 } : ci ); }
      return [...prev, { id: uid(), productId: selectedProduct.id, name: displayName, price: unitPrice, qty: 1, note: itemNote||undefined, sizeId: selSize, toppingIds: [...selToppings] }];
    });
    setCustomOpen(false);
  };

  const inc = (id:string) => setCart(prev => prev.map(ci => ci.id===id ? { ...ci, qty: ci.qty+1 } : ci));
  const dec = (id:string) => setCart(prev => prev.map(ci => ci.id===id ? { ...ci, qty: Math.max(1, ci.qty-1) } : ci));
  const rm  = (id:string) => setCart(prev => prev.filter(ci => ci.id!==id));
  const clearCart = () => { setCart([]); setDiscount(0); setIncludeTax(false); setIncludeService(false); setCash(0); setNote(""); setPayMethod("Tunai"); };

  const onPay = () => { setPayOpen(true); if(payMethod==="Tunai") setCash(total); };
  const finalize = () => {
    const paidCash = payMethod==="Tunai" ? (cash||0) : total;
    const rec: SaleRecord = {
      id: `CM-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${uid().toUpperCase()}`,
      time: nowStr(), timeMs: Date.now(), items: cart, subtotal, discount: discount||0, taxRate: includeTax?settings.taxRate:0, service: includeService?settings.service:0,
      total, cash: paidCash, change: Math.max(0, paidCash - total), payMethod
    };
    setSales(prev => [rec, ...prev]);
    printReceipt(rec);
    setPayOpen(false);
    clearCart();
  };

  const printAreaRef = useRef<HTMLDivElement>(null);
  const printReceipt = (rec: SaleRecord) => {
    const w = window.open("", "_blank", "width=380,height=600");
    if(!w) return;
    const itemsHtml = rec.items.map(i => `<tr><td>${i.name}${i.note?`<div style='font-size:10px;opacity:.7'>${i.note}</div>`:""}</td><td style='text-align:center'>${i.qty}x</td><td style='text-align:right'>${IDR(i.price*i.qty)}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>Struk</title>
      <style>
        body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
        .wrap{width:280px;margin:0 auto}
        h2{margin:8px 0;text-align:center}
        table{width:100%;border-collapse:collapse}
        td{padding:4px 0;border-bottom:1px dashed #ddd;font-size:12px}
        .tot td{border-bottom:none;font-weight:700}
        .meta{font-size:12px;text-align:center;opacity:.8}
      </style></head><body>
      <div class='wrap'>
        <h2>${settings.shopName}</h2>
        <div class='meta'>${rec.id}<br/>${rec.time}</div>
        <div class='meta'>Metode: ${rec.payMethod||"Tunai"}</div>
        <hr/>
        <table>
          ${itemsHtml}
          <tr class='tot'><td>Subtotal</td><td></td><td style='text-align:right'>${IDR(rec.subtotal)}</td></tr>
          ${rec.taxRate?`<tr class='tot'><td>Pajak (${rec.taxRate}%)</td><td></td><td style='text-align:right'>${IDR(Math.round(rec.subtotal*(rec.taxRate/100)))}</td></tr>`:""}
          ${rec.service?`<tr class='tot'><td>Service (${settings.service}%)</td><td></td><td style='text-align:right'>${IDR(Math.round(rec.subtotal*(settings.service/100)))}</td></tr>`:""}
          ${rec.discount?`<tr class='tot'><td>Diskon</td><td></td><td style='text-align:right'>-${IDR(rec.discount)}</td></tr>`:""}
          <tr class='tot'><td>Total</td><td></td><td style='text-align:right'>${IDR(rec.total)}</td></tr>
          <tr><td>Dibayar</td><td></td><td style='text-align:right'>${IDR(rec.cash)}</td></tr>
          <tr><td>Kembali</td><td></td><td style='text-align:right'>${IDR(rec.change)}</td></tr>
        </table>
        <p class='meta'>Terima kasih! Follow @chafumatcha</p>
      </div>
      <script>window.print()</script>
    </body></html>`;
    w.document.write(html);
    w.document.close();
  };

  const exportCSV = () => {
    const rows = [
      ["ID","Waktu","Metode","Item (qty)","Subtotal","Diskon","Pajak%","Service%","Total","Dibayar","Kembali"],
      ...sales.map(s => [
        s.id,
        s.time,
        s.payMethod||"Tunai",
        s.items.map(i=>`${i.name}(${i.qty})`).join("; "),
        s.subtotal,
        s.discount,
        s.taxRate,
        s.service,
        s.total,
        s.cash,
        s.change,
      ])
    ];
    const csv = rows.map(r => r.map(String).map(v => '"'+v.replaceAll('"','""')+'"').join(",")).join("\\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `kasir_chafu_sales_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Product|null>(null);
  const emptyProduct = { id: "", name: "", price: 0, category: "Signature", active: true } as Product;
  const [form, setForm] = useState<Product>(emptyProduct);

  const openNew = () => { setEditing(null); setForm({...emptyProduct, id: uid()}); setEditOpen(true); };
  const openEdit = (p:Product) => { setEditing(p); setForm({...p}); setEditOpen(true); };
  const saveProduct = () => {
    if(!form.name || form.price<=0) return alert("Nama & harga wajib diisi");
    setProducts(prev => {
      const exist = prev.find(x=>x.id===form.id);
      if(exist){ return prev.map(x=>x.id===form.id?{...form}:x); }
      return [...prev, {...form}];
    });
    setEditOpen(false);
  };
  const deleteProduct = (id:string) => {
    if(!confirm("Hapus produk ini?")) return; setProducts(prev => prev.filter(x=>x.id!==id));
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { setCanInstall(false); }
    setDeferredPrompt(null);
  };

  return (
    <div style={{minHeight:'100vh', padding:16}}>
      <div style={{maxWidth:1200, margin:'0 auto'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <div style={{width:40, height:40, borderRadius:12, background:'#166534'}} />
            <div>
              <div style={{fontSize:20, fontWeight:700}}>{settings.shopName} — Kasir</div>
              <div style={{fontSize:12, color:'#666'}}>{nowStr()}</div>
            </div>
          </div>
          <div style={{display:'flex', gap:8}}>
            {canInstall && (<Button onClick={handleInstall}>Tambah ke Layar Utama</Button>)}
            <Dialog>
              <DialogTrigger asChild>
                <Button><span style={{marginRight:6}}>⚙️</span>Pengaturan</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Pengaturan Toko</DialogTitle></DialogHeader>
                <div style={{display:'grid', gap:10}}>
                  <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center'}}>
                    <Label>Nama Toko</Label>
                    <Input value={settings.shopName} onChange={e=>setSettings({...settings, shopName:e.target.value})}/>
                  </div>
                  <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center'}}>
                    <Label>Pajak %</Label>
                    <Input type="number" value={settings.taxRate} onChange={e=>setSettings({...settings, taxRate:Number(e.target.value)})}/>
                  </div>
                  <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center'}}>
                    <Label>Service %</Label>
                    <Input type="number" value={settings.service} onChange={e=>setSettings({...settings, service:Number(e.target.value)})}/>
                  </div>
                  <div style={{fontSize:12, color:'#666'}}>Aktifkan saat transaksi bila diperlukan.</div>
                </div>
              </DialogContent>
            </Dialog>
            <Button onClick={exportCSV}>Export CSV</Button>
          </div>
        </div>

        <Tabs defaultValue="pos">
          <TabsList>
            <TabsTrigger value="pos">Kasir</TabsTrigger>
            <TabsTrigger value="history">Riwayat</TabsTrigger>
            <TabsTrigger value="products">Produk</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          </TabsList>

          <TabsContent value="pos">
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
              <Card>
                <CardHeader>
                  <CardTitle>Menu</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{display:'flex', gap:8, marginBottom:12, alignItems:'center'}}>
                    <Input placeholder="Cari menu…" value={query} onChange={e=>setQuery(e.target.value)} />
                    <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}>
                      {["All", ...Array.from(new Set(products.map(p=>p.category)))].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:8}}>
                    {filtered.map(p => (
                      <button key={p.id} onClick={()=>openCustomize(p)} style={{textAlign:'left', border:'1px solid #eee', borderRadius:12, padding:12, background:'#fff'}}>
                        <div style={{height:80, background:'#eaf5ee', borderRadius:10, marginBottom:8}}/>
                        <div style={{fontWeight:600}}>{p.name}</div>
                        <div style={{fontSize:12, color:'#666'}}>{p.category}</div>
                        <div style={{fontWeight:700}}>{IDR(p.price)}</div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Keranjang</CardTitle></CardHeader>
                <CardContent>
                  <div style={{display:'flex', gap:8, marginBottom:8}}>
                    <Input placeholder="Catatan default (mis. less sugar / no ice)" value={note} onChange={e=>setNote(e.target.value)} />
                    <Button onClick={()=>setNote("")}>Clear</Button>
                  </div>

                  {cart.length===0 ? (
                    <div style={{fontSize:14, color:'#666'}}>Belum ada item. Klik menu untuk menambahkan.</div>
                  ) : (
                    <div style={{display:'grid', gap:8}}>
                      {cart.map(ci => (
                        <div key={ci.id} style={{display:'grid', gridTemplateColumns:'1fr 80px 120px 40px', alignItems:'center', gap:8, border:'1px solid #eee', borderRadius:10, padding:8}}>
                          <div>
                            <div style={{fontWeight:600}}>{ci.name}</div>
                            {ci.note && <div style={{fontSize:12, color:'#666'}}>{ci.note}</div>}
                          </div>
                          <div style={{textAlign:'right'}}>{IDR(ci.price)}</div>
                          <div style={{display:'flex', gap:8, justifyContent:'flex-end', alignItems:'center'}}>
                            <Button onClick={()=>dec(ci.id)}>−</Button>
                            <div style={{width:24, textAlign:'center'}}>{ci.qty}</div>
                            <Button onClick={()=>inc(ci.id)}>+</Button>
                          </div>
                          <div style={{display:'flex', justifyContent:'flex-end'}}>
                            <Button onClick={()=>rm(ci.id)}>🗑️</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid #eee'}}>
                    <div style={{display:'flex', justifyContent:'space-between'}}><span>Subtotal</span><strong>{IDR(subtotal)}</strong></div>
                    <div style={{display:'flex', justifyContent:'space-between', marginTop:6}}>
                      <label><input type="checkbox" checked={includeTax} onChange={e=>setIncludeTax(e.target.checked)} /> Pajak ({settings.taxRate}%)</label>
                      <span>{includeTax?IDR(tax):IDR(0)}</span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', marginTop:6}}>
                      <label><input type="checkbox" checked={includeService} onChange={e=>setIncludeService(e.target.checked)} /> Service ({settings.service}%)</label>
                      <span>{includeService?IDR(service):IDR(0)}</span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', marginTop:6, alignItems:'center'}}>
                      <span>Diskon (Rp)</span>
                      <Input type="number" value={discount} onChange={e=>setDiscount(Number(e.target.value)||0)} />
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', marginTop:10, fontWeight:700}}>
                      <span>Total</span><span>{IDR(total)}</span>
                    </div>
                  </div>

                  <div style={{display:'flex', justifyContent:'space-between', marginTop:12}}>
                    <Button onClick={clearCart}>Bersihkan</Button>
                    <div style={{display:'flex', gap:8}}>
                      <Button onClick={()=>printReceipt({ id:"DRAFT", time: nowStr(), timeMs: Date.now(), items: cart, subtotal, discount:discount||0, taxRate: includeTax?settings.taxRate:0, service: includeService?settings.service:0, total, cash: payMethod==="Tunai"?cash:total, change: change, payMethod })}>Print Draf</Button>
                      <Button onClick={onPay}>Bayar</Button>
                    </div>
                  </div>

                  {payOpen && (
                    <DialogContent>
                      <DialogHeader><DialogTitle>Pembayaran</DialogTitle></DialogHeader>
                      <div style={{display:'grid', gap:8}}>
                        <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8}}>
                          <Label>Metode</Label>
                          <select value={payMethod} onChange={e=>setPayMethod(e.target.value)}>
                            {PAY_METHODS.map(m=> <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div style={{display:'flex', justifyContent:'space-between'}}><span>Total</span><strong>{IDR(total)}</strong></div>
                        {payMethod==="Tunai" && (
                          <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8}}>
                            <Label>Tunai</Label>
                            <Input type="number" value={cash} onChange={e=>setCash(Number(e.target.value)||0)} />
                          </div>
                        )}
                        <div style={{display:'flex', justifyContent:'space-between'}}><span>Kembali</span><span>{IDR(change)}</span></div>
                      </div>
                      <DialogFooter>
                        <Button onClick={()=>setPayOpen(false)}>Batal</Button>
                        <Button onClick={finalize} disabled={payMethod==="Tunai" && cash<total}>Selesaikan & Cetak</Button>
                      </DialogFooter>
                    </DialogContent>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle>Riwayat Penjualan</CardTitle></CardHeader>
              <CardContent>
                {sales.length===0? (
                  <div>Belum ada transaksi.</div>
                ) : (
                  <div style={{overflow:'auto'}}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Waktu</TableHead>
                          <TableHead>ID</TableHead>
                          <TableHead>Metode</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sales.map(s => (
                          <TableRow key={s.id}>
                            <TableCell>{s.time}</TableCell>
                            <TableCell>{s.id}</TableCell>
                            <TableCell>{s.payMethod||"Tunai"}</TableCell>
                            <TableCell>{s.items.map(i=>`${i.name} x${i.qty}`).join(", ")}</TableCell>
                            <TableCell>{IDR(s.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard">
            <Card>
              <CardHeader><CardTitle>Ringkasan Harian</CardTitle></CardHeader>
              <CardContent>
                {(()=>{
                  const withTime = sales.map(s=> ({...s, timeMs: s.timeMs || new Date(s.time).getTime()}));
                  const toKey = (ms:number) => new Date(ms).toISOString().slice(0,10);
                  const todayKey = toKey(Date.now());
                  const todaySales = withTime.filter(s=> toKey(s.timeMs)===todayKey);
                  const omzet = todaySales.reduce((a,b)=>a+b.total,0);
                  const trx = todaySales.length;
                  const aov = trx? Math.round(omzet/trx):0;
                  const itemCount: Record<string, number> = {};
                  todaySales.forEach(s=> s.items.forEach(i=> { itemCount[i.name] = (itemCount[i.name]||0)+i.qty; }));
                  const top = Object.entries(itemCount).sort((a,b)=>b[1]-a[1]).slice(0,3);

                  const days: {date:string, omzet:number, trx:number}[] = [];
                  for(let i=13;i>=0;i--){
                    const d = new Date(); d.setDate(d.getDate()-i);
                    const key = toKey(d.getTime());
                    const list = withTime.filter(s=> toKey(s.timeMs)===key);
                    const o = list.reduce((a,b)=>a+b.total,0);
                    days.push({date:key, omzet:o, trx:list.length});
                  }

                  return (
                    <div style={{display:'grid', gap:12}}>
                      <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8}}>
                        <div style={{border:'1px solid #eee', borderRadius:12, padding:12}}><div style={{fontSize:12, color:'#666'}}>Omzet Hari Ini</div><div style={{fontSize:18, fontWeight:700}}>{IDR(omzet)}</div></div>
                        <div style={{border:'1px solid #eee', borderRadius:12, padding:12}}><div style={{fontSize:12, color:'#666'}}>Transaksi</div><div style={{fontSize:18, fontWeight:700}}>{trx}</div></div>
                        <div style={{border:'1px solid #eee', borderRadius:12, padding:12}}><div style={{fontSize:12, color:'#666'}}>AOV</div><div style={{fontSize:18, fontWeight:700}}>{IDR(aov)}</div></div>
                        <div style={{border:'1px solid #eee', borderRadius:12, padding:12}}><div style={{fontSize:12, color:'#666'}}>Item Terlaris</div><div style={{fontSize:14, fontWeight:600}}>{top.length? `${top[0][0]} (${top[0][1]})` : '-'}</div></div>
                      </div>
                      <div style={{overflow:'auto'}}>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Tanggal</TableHead>
                              <TableHead>Transaksi</TableHead>
                              <TableHead>Omzet</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {days.map(d => (
                              <TableRow key={d.date}>
                                <TableCell>{d.date}</TableCell>
                                <TableCell>{d.trx}</TableCell>
                                <TableCell>{IDR(d.omzet)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="products">
            <Card>
              <CardHeader><CardTitle>Manajemen Produk</CardTitle></CardHeader>
              <CardContent>
                <div style={{display:'flex', justifyContent:'flex-end', marginBottom:8}}>
                  <Button onClick={()=>openNew()}>Tambah Produk</Button>
                </div>
                <div style={{overflow:'auto'}}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead>Kategori</TableHead>
                        <TableHead>Harga</TableHead>
                        <TableHead>Aktif</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map(p => (
                        <TableRow key={p.id}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>{p.category}</TableCell>
                          <TableCell>{IDR(p.price)}</TableCell>
                          <TableCell><input type="checkbox" checked={p.active!==false} onChange={e=>setProducts(prev=>prev.map(x=>x.id===p.id?{...x, active:e.target.checked}:x))} /></TableCell>
                          <TableCell>
                            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                              <Button onClick={()=>openEdit(p)}>Edit</Button>
                              <Button onClick={()=>deleteProduct(p.id)}>Hapus</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {editOpen && (
              <DialogContent>
                <DialogHeader><DialogTitle>{editing? "Edit Produk":"Tambah Produk"}</DialogTitle></DialogHeader>
                <div style={{display:'grid', gap:8}}>
                  <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center'}}>
                    <Label>Nama</Label>
                    <Input value={form.name} onChange={e=>setForm({...form, name:e.target.value})}/>
                  </div>
                  <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center'}}>
                    <Label>Kategori</Label>
                    <Input value={form.category} onChange={e=>setForm({...form, category:e.target.value})}/>
                  </div>
                  <div style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center'}}>
                    <Label>Harga</Label>
                    <Input type="number" value={form.price} onChange={e=>setForm({...form, price:Number(e.target.value)||0})}/>
                  </div>
                  <label><input type="checkbox" checked={form.active!==false} onChange={e=>setForm({...form, active:e.target.checked})}/> Aktif</label>
                </div>
                <DialogFooter>
                  <Button onClick={()=>setEditOpen(false)}>Batal</Button>
                  <Button onClick={saveProduct}>Simpan</Button>
                </DialogFooter>
              </DialogContent>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <div ref={printAreaRef} style={{display:'none'}} />
    </div>
  );
}
