# Zonder: Layout kerja, panel Perubahan, dan logo model

Tanggal: 2026-11-01. Melengkapi `2026-11-01-zonder-design.md` dan `2026-11-01-zonder-settings-design.md`; bagian yang tidak disebut di sini tetap mengikuti dokumen itu. Mockup yang disetujui: `.superpowers/brainstorm/1282-1793547312/content/layout-v2.html`, kartu "Bawaan: kantor tampil".

## 1. Maksud dan alasan

Pemilik membuat Zonder untuk **memvisualisasikan kantor agent**. Kantor isometrik adalah pusat app dan tetap tampil secara bawaan.

Pemilik menunjukkan contoh app lain (sidebar proyek dengan agent per repo, tab agent, panel file di kanan) dan ingin Zonder terasa seperti itu, disesuaikan dengan layout sekarang. Dua hal yang kurang saat ini:
- **Pemilik tidak bisa melihat apa yang diubah agent.** Ia biasanya hanya "cek-cek". Yang ia perlukan adalah tahu file apa yang disentuh agent dan isinya, bukan menelusuri seluruh pohon worktree.
- **Lebar kolom tidak bisa diatur.** Grid sekarang tetap `220px 1fr 340px`.

Tambahan yang diminta: **logo model** di samping tiap agent. Pemilik hampir selalu memakai **combo** 9router (misalnya `daily-coding`, `budget-zero`). Ia ingin tahu **model mana yang barusan menjawab**, bukan isi combo-nya.

## 2. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Sidebar mengelompokkan agent per repo (workspace).
- Tiap agent punya logo model, dan logo agent 9router mengikuti model yang terakhir menjawab.
- Kolom kanan punya dua tampilan untuk agent terpilih: **Chat** dan **Perubahan**.
- Perubahan menampilkan daftar file yang diubah agent dan diff satu file, hanya untuk dibaca, plus tombol "Buka folder".
- Lebar ketiga kolom bisa diatur dengan mouse dan keyboard, dan diingat.
- Kantor bisa disembunyikan, dan pilihan itu diingat.

**Bukan-tujuan (versi ini)**
- Pohon file lengkap worktree, editor file, atau mengedit file dari Zonder.
- Terminal sungguhan (PTY/xterm tetap di luar scope).
- Tumpukan logo anggota combo.
- Commit, stage, atau revert dari panel Perubahan.
- Tema terang (tetap dark only).

**Anti-tujuan (gagal walau jalan)**
- Kantor terasa jadi fitur sampingan: terlipat secara bawaan, atau ruangnya habis dimakan panel lain.
- Panel Perubahan menampilkan file yang tidak diubah agent, atau melewatkan file yang diubah.
- Logo dipakai sebagai satu-satunya penanda status, atau logo yang salah ditampilkan seolah pasti.
- Ukuran kolom hanya bisa diatur dengan mouse.
- Zonder mengambil logo dari internet saat berjalan.

## 3. Batasan

- Tanpa dependensi npm baru. Tanpa PTY/node-pty/xterm.
- Dark only, gaya Zonder sekarang: garis 1px, warna hanya untuk status, aturan antislop berlaku.
- Renderer tetap vanilla JS dengan helper `el()`; main tetap CommonJS; preload tetap sempit, dan renderer tidak pernah menerima path di luar worktree agent itu sendiri.
- Semua git dijalankan di main, di dalam worktree agent (`record.worktreePath`), tanpa shell.
- Key 9router tidak pernah dibaca, dicatat, atau dikirim ke renderer.

## 4. Desain

### 4.1 Susunan layar

Tiga kolom di bawah header, seperti sekarang:

| Kolom | Isi | Lebar bawaan | Lebar minimum |
|---|---|---|---|
| Kiri | Sidebar: tombol Spawn, agent per repo, status 9router | 240px | 180px |
| Tengah | Kantor isometrik | sisa ruang | 360px |
| Kanan | Tab agent, kepala chat, tab Chat / Perubahan, isi | 380px | 300px |

Di antara kolom ada **pembatas** yang bisa ditarik (lihat §4.5). Saat kantor disembunyikan (§4.6), kolom kanan mengisi sisa ruang.

### 4.2 Sidebar per repo

- Agent dikelompokkan menurut `record.workspace` (repo utama). Judul grup = nama folder repo, dengan path lengkap di tooltip. Grup diurutkan menurut agent terbaru di dalamnya; di dalam grup, urutan agent tetap seperti sekarang.
- Kartu agent tetap memuat nama, peran, status, dan baris terakhir. Tambahannya **logo model** di kiri nama, dan teks model di bawahnya (lihat §4.3).
- Titik status tetap di kartu. Status tidak pernah hanya ditunjukkan oleh logo.
- Grup bisa dilipat dengan tombol di judulnya (`aria-expanded`). Grup yang dilipat menampilkan jumlah agent dan jumlah yang butuh izin, dalam teks.
- Agent contoh (mode mock) masuk grup "Contoh".

### 4.3 Logo model

**Sumber.** Empat logo SVG diunduh **sekali** dari koleksi ikon open source (pilihan pertama LobeHub Icons, MIT; cadangan Simple Icons, CC0) ke `src/renderer/assets/models/`: Claude, OpenAI, Gemini, DeepSeek. Pengunduhan dilakukan saat implementasi, dan izin pemilik diminta dulu dengan menyebut nama file, sumber, dan ukurannya. Lisensi sumber dicatat di `src/renderer/assets/models/LICENSE.md`. Logo hanya menandai penyedia model, bukan merek Zonder.

**Pemetaan.** Fungsi murni `modelFamily(id)`:
1. Buang awalan jalur 9router: semua sebelum `/` terakhir (`kr/claude-sonnet-4.5` menjadi `claude-sonnet-4.5`).
2. Cocokkan awal nama, tanpa membedakan huruf besar/kecil: `claude`, `opus`, `sonnet`, `haiku` = claude; `gpt`, `o1`, `o3`, `o4`, `chatgpt` = openai; `gemini` = gemini; `deepseek` = deepseek.
3. Tidak cocok = `null`.

**Yang ditampilkan.**
- Agent Claude: logo Claude.
- Agent 9router: logo dari **model yang terakhir menjawab** (§4.4). Teks model menjadi `daily-coding · claude-sonnet-4.5`. Sebelum ada jawaban, atau saat 9router tidak melaporkan model, atau model tidak dikenali, ditampilkan **ikon combo netral** (garis 1px, abu-abu) kalau nama yang dipilih tidak berisi `/`, atau **lingkaran inisial** (huruf pertama nama model) kalau berisi `/`.
- Logo 16px di sidebar dan tab agent, `alt`/`aria-label` berisi nama keluarga model ("Claude", "OpenAI"...). Logo berwarna asli dibuat monokrom abu-abu (`--muted`) supaya warna tetap hanya untuk status.

### 4.4 Model yang barusan menjawab (agent 9router)

- `router-client.js` membaca field `model` dari tiap potongan SSE (yang pertama berisi string tidak kosong) dan meneruskannya sebagai `{ servedModel }`.
- `router-agent.js` menyimpan `record.servedModel` setelah tiap giliran dan mengirim event status agar renderer memperbarui logo. Nilai ini ikut tersimpan seperti field record lain.
- Kalau `servedModel` sama dengan nama yang dipilih (9router hanya mengulang nama combo), tampilan jatuh ke ikon combo netral.
- **Belum pasti** apakah 9router mengisi `model` dengan model asli. Pengecekan dilakukan saat implementasi: pemilik menjalankan Zonder dengan key-nya dan mengirim satu pesan ke agent combo; implementer hanya membaca `servedModel` dari `agents.json` atau log, tidak pernah key-nya. Desain ini aman untuk dua kemungkinan hasil.

### 4.5 Kolom yang bisa diatur

- Dua pembatas: kiri|tengah dan tengah|kanan. Masing-masing `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max` dalam piksel, `tabindex="0"`, dengan fokus terlihat.
- Mouse: tarik untuk mengubah lebar; klik dua kali untuk kembali ke bawaan.
- Keyboard: panah kiri/kanan menggeser 16px (Shift: 64px), Home/End ke minimum/maksimum, Enter kembali ke bawaan.
- Lebar dijepit ke minimum di §4.1. Saat jendela mengecil, kolom kanan dan kiri mengecil dulu sampai minimum sebelum kantor di bawah 360px.
- Lebar disimpan di `localStorage` (`zonder.layout`). Kalau kosong, rusak, atau tidak bisa dibaca, dipakai lebar bawaan tanpa error.
- Kanvas kantor menggambar ulang saat kolomnya berubah ukuran (ResizeObserver).

### 4.6 Kantor bisa disembunyikan

- Tombol baru di deretan ikon header, sebelum Settings: "Sembunyikan kantor" / "Tampilkan kantor" (`aria-pressed`).
- Saat disembunyikan, kolom tengah dan pembatasnya hilang, kolom kanan mengisi ruang, dan loop gambar kantor berhenti. Legend status pindah ke kepala kolom kanan supaya ringkasan status tetap terlihat.
- Pilihan disimpan di `localStorage` (`zonder.layout`). Bawaannya **tampil**.

### 4.7 Kolom kanan: Chat dan Perubahan

- Tab agent di atas dan kepala chat tetap seperti sekarang.
- Di bawah kepala ada dua tab tampilan (`role="tablist"`): **Chat** dan **Perubahan (n)**. `n` adalah jumlah file berubah, dan tidak ditampilkan sebelum pernah dihitung. Pilihan tab diingat per agent selama sesi.
- Composer hanya tampil di tab Chat.

### 4.8 Panel Perubahan

**Arti "diubah agent".** Semua perbedaan worktree terhadap titik awal agent: `git merge-base <baseBranch> HEAD` dibandingkan dengan isi worktree sekarang, ditambah file baru yang belum di-track. Jadi commit yang dibuat agent dan perubahan yang belum di-commit sama-sama terhitung. File yang di-ignore tidak dihitung.

**IPC baru** (main, divalidasi seperti channel lain, hanya untuk agent milik app):
- `listChanges(agentId) -> { files: [{ path, status: 'M' | 'A' | 'D' | 'R', oldPath? }], base: string }`. Dari `git diff --name-status -M <mergeBase>` plus `git ls-files --others --exclude-standard`. Path relatif terhadap worktree.
- `fileDiff(agentId, path) -> { path, text, truncated: boolean, binary: boolean }`. Path harus ada di hasil `listChanges` terakhir (bukan path bebas). Diff unified dari `git diff <mergeBase> -- <path>`; file baru ditampilkan sebagai diff tambahan seluruh isi. Dipotong di 200 KB dengan catatan; file biner tidak ditampilkan isinya.
- `openWorktree(agentId)`. Membuka `record.worktreePath` di Explorer lewat `shell.openPath`.

**Kapan dihitung ulang.** Saat tab Perubahan dibuka, saat agent selesai satu giliran (status jadi idle/done/error) selama tab itu terbuka, dan lewat tombol "Muat ulang". Tidak ada pengawasan folder (watcher).

**Tampilan.**
- Daftar file: huruf status (M/A/D/R, dengan teks lengkap di `title`) plus path. Warna huruf mengikuti token status yang sudah ada, dan selalu disertai hurufnya.
- Klik file: diff tampil di bawah daftar, font mono, baris tambah/hapus dibedakan warna **dan** awalan `+`/`-`.
- Tombol "Buka folder" dan "Muat ulang" di atas daftar.
- State: memuat ("Membaca perubahan..."), kosong ("Belum ada perubahan dari agent ini."), error (pesan git + tombol "Coba lagi"), worktree sudah dihapus ("Worktree agent ini sudah tidak ada."), diff dipotong, dan file biner.

### 4.9 Mobile dan jendela sempit

Zonder adalah app desktop. Di bawah lebar total minimum (180 + 360 + 300 = 840px), kantor disembunyikan otomatis untuk sesi itu tanpa mengubah pilihan tersimpan, dan muncul catatan kecil di header. Tidak ada overflow horizontal.

## 5. Yang diputuskan pemilik

- Kantor tetap pusat dan **tampil secara bawaan**; bisa disembunyikan.
- Panel kanan berisi **perubahan agent** (daftar + diff + buka folder), bukan pohon file lengkap.
- Logo agent 9router mengikuti **model yang barusan menjawab**.
- Logo resmi **diunduh oleh implementer** (dengan izin), tidak disediakan pemilik.
- Logo yang diperlukan: Claude, OpenAI, Gemini, DeepSeek.
- Desain ini dikerjakan **sebelum** Tugas 18–20 plan settings.

## 6. Keputusan implementer (dicatat sebagai keputusan, bukan persetujuan pemilik)

- Lebar bawaan dan minimum kolom di §4.1.
- Layout disimpan di `localStorage`, bukan di settings store, karena store Tugas 18 belum ada dan ini kenyamanan tampilan per mesin.
- Tombol kantor di header saja; tidak ada opsi di halaman Settings.
- Tab agent di atas kolom kanan dipertahankan; tab Chat/Perubahan ditaruh di bawah kepala chat.
- Logo monokrom abu-abu, bukan warna merek.
- Batas diff 200 KB; tidak ada watcher.
- Grup repo bisa dilipat.

## 7. Dampak ke rencana lain

- **Tugas 20 (kantor hidup)** menggambar di kanvas yang sekarang bisa berubah ukuran dan bisa disembunyikan; animasinya harus berhenti saat kantor disembunyikan dan menyesuaikan ukuran lewat ResizeObserver dari §4.5.
- **Tugas 18 (settings store)** boleh memindahkan `zonder.layout` ke store nanti; itu bukan syarat desain ini.

## 8. Yang diserahkan ke builder

- Bentuk persis ikon combo netral dan pembatas kolom, mengikuti gaya garis 1px.
- Struktur file renderer (modul baru untuk layout, perubahan, dan logo, atau digabung ke file yang ada).
- Cara menguji: fungsi murni (`modelFamily`, penjepit lebar, parser `--name-status`) dengan `node:test`; IPC dengan repo git sementara; pengecekan akhir lewat CDP seperti tugas sebelumnya.
