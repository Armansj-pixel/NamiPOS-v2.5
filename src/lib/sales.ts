// src/lib/sales.ts
import {
  collection, getDocs, query, where, orderBy, limit,
  startAfter, Timestamp, QueryConstraint, DocumentData
} from "firebase/firestore";
import { db } from "./firebase";

export type SaleItem = { name: string; price: number; qty: number; note?: string };
export type SaleDoc = {
  id: string;
  outlet: string;
  shiftId?: string;
  cashierEmail: string;
  customerPhone?: string;
  time: Timestamp;        // Wajib Timestamp utk orderBy
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  service: number;
  total: number;
  payMethod: "cash" | "ewallet" | "qris";
  cash?: number;
  change?: number;
};

/**
 * Ambil riwayat transaksi dengan filter opsional + pagination.
 * - outlet (disarankan selalu diisi)
 * - date range (start/end)
 * - shiftId, cashierEmail, customerPhone (opsional)
 * - pageSize default 50
 * - cursor untuk pagination (pass docSnapshot dari hasil sebelumnya)
 */
export async function getSalesHistory(opts: {
  outlet: string;
  start?: Date;           // awal rentang tanggal (inclusive)
  end?: Date;             // akhir rentang tanggal (exclusive)
  shiftId?: string;
  cashierEmail?: string;
  customerPhone?: string;
  pageSize?: number;
  cursor?: DocumentData | null;
}): Promise<{ rows: SaleDoc[]; nextCursor?: DocumentData | null }> {
  const {
    outlet, start, end, shiftId, cashierEmail, customerPhone,
    pageSize = 50, cursor = null,
  } = opts;

  const cons: QueryConstraint[] = [];

  // Filter equality diletakkan dulu (agar index sederhana cukup)
  cons.push(where("outlet", "==", outlet));

  if (shiftId) cons.push(where("shiftId", "==", shiftId));
  if (cashierEmail) cons.push(where("cashierEmail", "==", cashierEmail));
  if (customerPhone) cons.push(where("customerPhone", "==", customerPhone));

  // Rentang tanggal menggunakan Timestamp
  if (start) cons.push(where("time", ">=", Timestamp.fromDate(start)));
  if (end)   cons.push(where("time", "<",  Timestamp.fromDate(end)));

  // Urutan default: terbaru dulu
  cons.push(orderBy("time", "desc"));

  if (cursor) cons.push(startAfter(cursor));
  cons.push(limit(pageSize));

  try {
    const q = query(collection(db, "sales"), ...cons);
    const snap = await getDocs(q);

    const rows: SaleDoc[] = snap.docs.map(d => {
      const x = d.data() as any;
      return {
        id: d.id,
        outlet: x.outlet,
        shiftId: x.shiftId,
        cashierEmail: x.cashierEmail,
        customerPhone: x.customerPhone,
        time: x.time, // Timestamp
        items: x.items || [],
        subtotal: x.subtotal ?? 0,
        discount: x.discount ?? 0,
        tax: x.tax ?? 0,
        service: x.service ?? 0,
        total: x.total ?? 0,
        payMethod: x.payMethod ?? "cash",
        cash: x.cash, change: x.change,
      };
    });

    const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    return { rows, nextCursor };
  } catch (err: any) {
    // Tangkap error “requires an index” & tampilkan linknya (kalau ada)
    if (err?.code === "failed-precondition" && err?.message?.includes("index")) {
      // di UI: tampilkan err.message agar admin bisa klik link create index
      console.warn("Firestore requires index:", err.message);
      throw new Error(
        "Query membutuhkan index Firestore. Klik link di pesan untuk membuat index,\n" +
        "lalu tunggu aktif (±2 menit) dan muat ulang halaman.\n\n" + err.message
      );
    }
    throw err;
  }
}