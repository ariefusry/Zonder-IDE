# Zonder IDE

> ## ⏸️ Status: ON HOLD
> Pengerjaan Zonder sedang **ditunda**. Kode di sini adalah snapshot terakhir (v0.1.0, prototipe). Belum ada rilis, belum ada jadwal lanjut, dan issue/PR belum tentu ditanggapi.

Aplikasi desktop (Electron) untuk menjalankan beberapa coding agent berdampingan, masing-masing di **Git worktree**-nya sendiri, dengan tampilan kantor isometrik yang menunjukkan siapa sedang mengerjakan apa.

## Fitur yang sudah ada

- Spawn beberapa agent sekaligus; setiap agent punya worktree terpisah sehingga tidak saling menimpa.
- Dua jenis backend agent: **Claude Code CLI** dan agent berbasis **router** (API kompatibel OpenAI, mis. 9router) dengan URL router milik sendiri.
- Daftar agent dikelompokkan per repo, dengan pemilih model dan logo model.
- Peran (role) bawaan dan persona, plus skill yang bisa dipakai agent.
- Chat per agent, antrean pesan, tombol interupsi, dan tampilan **File Changes**.
- Kartu persetujuan (approval) untuk aksi agent, dengan kebijakan izin.
- Kantor isometrik (Office) dengan avatar yang berpindah sesuai status, atau tampilan Grid.
- API key router dienkripsi dengan Electron `safeStorage` dan hanya dibaca di main process.

## Menjalankan

Prasyarat: Node.js, Git, dan (opsional) Claude Code CLI yang sudah login.

```bash
npm install
npm start      # buka aplikasi
npm test       # jalankan tes (node --test)
```

## Struktur

| Path | Isi |
|---|---|
| `src/main/` | proses utama: worktree, agent, IPC, persistensi, kebijakan izin |
| `src/preload/` | jembatan IPC ke renderer |
| `src/renderer/` | UI: sidebar, chat, perubahan file, kantor isometrik |
| `tests/` | tes unit |
| `docs/` | spesifikasi, rencana, dan mockup |
| `DESIGN.md` | arah visual (tema gelap) |

## Catatan

- Antarmuka sebagian besar berbahasa Indonesia.
- Dikembangkan dan diuji di Windows; platform lain belum diverifikasi.
- Aset model 3D punya lisensinya sendiri, lihat `src/renderer/assets/models/LICENSE.md`.
- Repo ini belum menyertakan lisensi untuk kode Zonder; tanpa lisensi, hak cipta tetap pada pemilik.
