
# CHAFU POS — Patch untuk Netlify Build Error

Perbaikan ini berisi 3 file:
1) `package.json` — menambahkan devDependency `@vitejs/plugin-react`
2) `vite.config.ts` — menambahkan alias `@` -> `src` agar import '@/components/..' dikenali saat build
3) `src/App.tsx` — mengganti `False` menjadi `false` pada dua tempat:
   - `setPayOpen(false)`
   - `setEditOpen(false)`

## Cara pakai (tanpa terminal)
1. Download ZIP patch ini.
2. Buka repo `chafu-pos` di GitHub → **Add file → Upload files**.
3. Upload 3 file di atas ke lokasi yang sama:
   - `package.json` (root, ganti yang lama)
   - `vite.config.ts` (root, ganti yang lama)
   - `src/App.tsx` (masuk ke folder `src/`, ganti yang lama — file di dalam ZIP bernama `src_App.tsx`, rename menjadi `App.tsx` saat upload).
4. Scroll ke bawah → **Commit changes**.
5. Kembali ke Netlify → tab **Deploys** → klik **Retry deploy**.

Selesai. Build harus hijau dan site langsung online ✅
