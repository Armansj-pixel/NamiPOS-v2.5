// App.tsx — NamiPOS v2.5.1 stable
import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  doc, collection, query, where, orderBy, limit, startAfter,
  serverTimestamp, onSnapshot, Timestamp
} from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, db } from "./lib/firebase";

/* ========= CONFIG ========= */
const OUTLET = "MTHaryono";
const OWNER_EMAILS = new Set(["antonius.arman123@gmail.com"]);
const QRIS_IMG_SRC = "/qris.png";
const LOGO_SRC = "/logo.png";

/* ========= TYPES ========= */
type Product = { id: string; name: string; price: number; category?: string; active?: boolean; imageUrl?: string };
type Ingredient = { id: string; name: string; unit: string; stock: number; min?: number };
type Recipe = { id: string; productId: string; items: { ingredientId: string; qty: number }[] };
type SaleItem = { name: string; price: number; qty: number; note?: string };
type Sale = {
  id?: string; outlet: string; shiftId: string | null; cashierEmail: string;
  customerPhone?: string | null; customerName?: string | null;
  time: Timestamp | null; items: SaleItem[];
  subtotal: number; discount: number; tax: number; service: number; total: number;
  payMethod: "cash" | "ewallet" | "qris"; cash?: number; change?: number;
};

/* ========= UTIL ========= */
const uid = () => Math.random().toString(36).slice(2, 10);
const IDR = (n: number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0);
const startOfDay = (d=new Date()) => {const x=new Date(d);x.setHours(0,0,0,0);return x;};
const endOfDay = (d=new Date()) => {const x=new Date(d);x.setHours(23,59,59,999);return x;};

/* ========= MAIN ========= */
export default function App(){
  const [user,setUser]=useState<{email:string}|null>(null);
  const isOwner=!!(user?.email&&OWNER_EMAILS.has(user.email));
  const [tab,setTab]=useState<"dashboard"|"pos"|"history"|"products"|"inventory">("pos");

  /* ---- master data ---- */
  const [products,setProducts]=useState<Product[]>([]);
  const [ingredients,setIngredients]=useState<Ingredient[]>([]);
  const [recipes,setRecipes]=useState<Recipe[]>([]);

  /* ---- POS ---- */
  const [cart,setCart]=useState<SaleItem[]>([]);
  const [customerPhone,setCustomerPhone]=useState(""); const [customerName,setCustomerName]=useState("");
  const [discount,setDiscount]=useState(0); const [taxPct,setTaxPct]=useState(0); const [svcPct,setSvcPct]=useState(0);
  const [payMethod,setPayMethod]=useState<"cash"|"ewallet"|"qris">("cash");
  const [cash,setCash]=useState(0);
  const subtotal=useMemo(()=>cart.reduce((a,b)=>a+b.price*b.qty,0),[cart]);
  const total=subtotal+subtotal*(taxPct+svcPct)/100-discount;
  const change=Math.max(0,(cash||0)-total);

  /* ---- shift ---- */
  const [activeShift,setActiveShift]=useState<any>(null);

  /* ---- auth ---- */
  useEffect(()=>{const unsub=onAuthStateChanged(auth,u=>setUser(u?.email?{email:u.email}:null));return()=>unsub();},[]);

  /* ---- load data ---- */
  useEffect(()=>{if(!user)return;
    const q1=query(collection(db,"products"));const q2=query(collection(db,"ingredients"));const q3=query(collection(db,"recipes"));
    const u1=onSnapshot(q1,s=>setProducts(s.docs.map(d=>({id:d.id,...d.data()}as Product))));
    const u2=onSnapshot(q2,s=>setIngredients(s.docs.map(d=>({id:d.id,...d.data()}as Ingredient))));
    const u3=onSnapshot(q3,s=>setRecipes(s.docs.map(d=>({id:d.id,...d.data()}as Recipe))));
    return()=>{u1();u2();u3();};
  },[user]);

  /* ========= LOGIN ========= */
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");
  const doLogin=async(e?:any)=>{e?.preventDefault();try{await signInWithEmailAndPassword(auth,email,password);}catch(e:any){alert(e.message);}};

  /* ========= POS ========= */
  const addToCart=(p:Product)=>setCart(c=>[...c,{name:p.name,price:p.price,qty:1}]);
  const finalize=async()=>{
    if(cart.length===0)return alert("Keranjang kosong");
    const sale:Sale={outlet:OUTLET,shiftId:activeShift?.id||null,cashierEmail:user!.email!,time:serverTimestamp() as any,
      items:cart,subtotal,discount,tax:subtotal*taxPct/100,service:subtotal*svcPct/100,total,payMethod,cash,change};
    const ref=await addDoc(collection(db,"sales"),sale);
    // loyalty
    if(customerPhone){
      const cRef=doc(db,"customers",customerPhone);
      const cSnap=await getDoc(cRef);const pts=Math.floor(total/15000);
      if(cSnap.exists()){
        const d=cSnap.data();const totalPts=(d.points||0)+pts;
        await updateDoc(cRef,{points:totalPts});
        if(totalPts>=10){await setDoc(doc(db,"free_drinks",ref.id),{phone:customerPhone,date:serverTimestamp()});await updateDoc(cRef,{points:totalPts-10});}
      }else await setDoc(cRef,{phone:customerPhone,name:customerName,points:pts});
    }
    // stok otomatis
    for(const item of cart){
      const rec=recipes.find(r=>r.productId===products.find(p=>p.name===item.name)?.id);
      if(rec)for(const ing of rec.items){
        const ingRef=doc(db,"ingredients",ing.ingredientId);
        const s=await getDoc(ingRef);if(s.exists()){
          const now=s.data() as any;
          await updateDoc(ingRef,{stock:(now.stock||0)-(ing.qty*item.qty)});
        }
      }
    }
    alert("Transaksi selesai");setCart([]);
  };

  /* ========= PRODUCTS UI ========= */
  const [form,setForm]=useState<Partial<Product>>({});const [showForm,setShowForm]=useState(false);
  const saveProduct=async()=>{
    const id=form.id||uid();
    await setDoc(doc(db,"products",id),{name:form.name,price:form.price,category:form.category||"Signature",active:form.active??true,imageUrl:form.imageUrl||""},{merge:true});
    setShowForm(false);
  };
  const toggleActive=(p:Product)=>updateDoc(doc(db,"products",p.id),{active:!(p.active!==false)});
  const delProd=(p:Product)=>{if(confirm("Hapus?"))deleteDoc(doc(db,"products",p.id));};

  /* ========= HISTORY ========= */
  const [history,setHistory]=useState<Sale[]>([]);
  const loadHistory=()=>onSnapshot(query(collection(db,"sales"),orderBy("time","desc"),limit(30)),s=>setHistory(s.docs.map(d=>({id:d.id,...d.data()})as Sale)));
  useEffect(()=>{if(tab==="history")return loadHistory();},[tab]);
  const delSale=(id:string)=>{if(confirm("Hapus transaksi ini?"))deleteDoc(doc(db,"sales",id));};

  /* ========= UI ========= */
  if(!user)return(
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={doLogin} className="bg-white p-6 rounded-2xl shadow w-80">
        <img src={LOGO_SRC} className="h-12 mx-auto mb-2"/>
        <h2 className="font-bold text-lg text-center mb-3">NamiPOS</h2>
        <input className="border p-2 w-full mb-2" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/>
        <input className="border p-2 w-full mb-3" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>
        <button className="bg-emerald-600 text-white w-full p-2 rounded">Masuk</button>
      </form>
    </div>
  );

  return(
    <div className="p-3 max-w-7xl mx-auto">
      <header className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <img src={LOGO_SRC} className="h-8"/><div className="font-bold">NamiPOS — {OUTLET}</div>
        </div>
        <nav className="flex gap-2">
          {isOwner&&<button onClick={()=>setTab("dashboard")} className={`border px-3 py-1 rounded ${tab==="dashboard"&&"bg-emerald-100"}`}>Dashboard</button>}
          <button onClick={()=>setTab("pos")} className={`border px-3 py-1 rounded ${tab==="pos"&&"bg-emerald-100"}`}>Kasir</button>
          <button onClick={()=>setTab("history")} className={`border px-3 py-1 rounded ${tab==="history"&&"bg-emerald-100"}`}>Riwayat</button>
          {isOwner&&<button onClick={()=>setTab("products")} className={`border px-3 py-1 rounded ${tab==="products"&&"bg-emerald-100"}`}>Produk</button>}
          <button onClick={()=>signOut(auth)} className="border px-3 py-1 rounded bg-rose-50">Keluar</button>
        </nav>
      </header>

      {tab==="pos"&&(
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <h2 className="font-semibold mb-2">Menu</h2>
            <div className="grid grid-cols-2 gap-2">
              {products.filter(p=>p.active!==false).map(p=>(
                <button key={p.id} onClick={()=>addToCart(p)} className="border p-2 rounded bg-white hover:bg-emerald-50">
                  {p.imageUrl&&<img src={p.imageUrl} className="h-20 w-full object-cover rounded mb-1"/>}
                  <div className="font-medium">{p.name}</div><div className="text-sm text-neutral-600">{IDR(p.price)}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-white p-3 rounded border">
            <h2 className="font-semibold mb-2">Keranjang</h2>
            {cart.map((c,i)=>(
              <div key={i} className="flex justify-between border-b py-1 text-sm">
                <span>{c.name} × {c.qty}</span><span>{IDR(c.price*c.qty)}</span>
              </div>
            ))}
            <div className="mt-3 text-sm border-t pt-2 flex justify-between"><b>Total</b><b>{IDR(total)}</b></div>
            <div className="mt-2 flex flex-col gap-1">
              <input placeholder="No HP" className="border p-1 rounded" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)}/>
              <input placeholder="Nama" className="border p-1 rounded" value={customerName} onChange={e=>setCustomerName(e.target.value)}/>
              <select value={payMethod} onChange={e=>setPayMethod(e.target.value as any)} className="border p-1 rounded">
                <option value="cash">Cash</option><option value="ewallet">E-Wallet</option><option value="qris">QRIS</option>
              </select>
              {payMethod==="cash"&&<input type="number" className="border p-1 rounded" placeholder="Tunai diterima" value={cash} onChange={e=>setCash(Number(e.target.value)||0)}/>}
              <button className="bg-emerald-600 text-white p-2 rounded mt-2" onClick={finalize}>Selesai</button>
            </div>
          </div>
        </div>
      )}

      {tab==="products"&&isOwner&&(
        <div className="bg-white border rounded p-3">
          <div className="flex justify-between mb-2"><h2 className="font-semibold">Produk</h2><button className="border px-2 rounded" onClick={()=>{setForm({});setShowForm(true);}}>+ Tambah</button></div>
          <table className="w-full text-sm">
            <thead><tr className="border-b"><th>Nama</th><th>Harga</th><th>Kategori</th><th>Gambar</th><th>Aksi</th></tr></thead>
            <tbody>
              {products.map(p=>(
                <tr key={p.id} className="border-b">
                  <td>{p.name}</td><td>{IDR(p.price)}</td><td>{p.category}</td>
                  <td>{p.imageUrl?<img src={p.imageUrl} className="h-8"/>:"-"}</td>
                  <td className="flex gap-1">
                    <button onClick={()=>{setForm(p);setShowForm(true);}} className="border px-2 rounded">Edit</button>
                    <button onClick={()=>toggleActive(p)} className="border px-2 rounded">{p.active!==false?"Nonaktif":"Aktifkan"}</button>
                    <button onClick={()=>delProd(p)} className="border px-2 rounded bg-rose-50">Hapus</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {showForm&&(
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center" onClick={()=>setShowForm(false)}>
              <div className="bg-white p-4 rounded w-80" onClick={e=>e.stopPropagation()}>
                <h3 className="font-semibold mb-2">{form.id?"Edit":"Tambah"} Produk</h3>
                <input className="border p-1 w-full mb-2" placeholder="Nama" value={form.name||""} onChange={e=>setForm({...form,name:e.target.value})}/>
                <input className="border p-1 w-full mb-2" type="number" placeholder="Harga" value={form.price||0} onChange={e=>setForm({...form,price:Number(e.target.value)||0})}/>
                <input className="border p-1 w-full mb-2" placeholder="Kategori" value={form.category||""} onChange={e=>setForm({...form,category:e.target.value})}/>
                <input className="border p-1 w-full mb-2" placeholder="URL Gambar" value={form.imageUrl||""} onChange={e=>setForm({...form,imageUrl:e.target.value})}/>
                {form.imageUrl&&<img src={form.imageUrl} className="h-16 mb-2"/>}
                <button className="bg-emerald-600 text-white w-full p-2 rounded" onClick={saveProduct}>Simpan</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab==="history"&&(
        <div className="bg-white border rounded p-3">
          <h2 className="font-semibold mb-2">Riwayat Transaksi</h2>
          <table className="w-full text-sm">
            <thead><tr className="border-b"><th>Waktu</th><th>Kasir</th><th>Total</th><th>Aksi</th></tr></thead>
            <tbody>{history.map(h=>(
              <tr key={h.id} className="border-b">
                <td>{h.time?new Date(h.time.toDate()).toLocaleString("id-ID"):"-"}</td>
                <td>{h.cashierEmail}</td>
                <td>{IDR(h.total)}</td>
                <td><button onClick={()=>delSale(h.id!)} className="border px-2 rounded bg-rose-50">Hapus</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}