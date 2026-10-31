# Zonder — Design

Tanggal: 2026-11-01. Platform: Windows 11, Electron. Menggantikan `zonder-design.md` lama di scratch (isinya sebagian sudah berubah, lihat bagian 9).

## 1. Maksud dan alasan

Zonder adalah aplikasi desktop untuk menjalankan beberapa agent coding secara paralel dan mengobrol dengan masing-masing. Setiap agent punya Git worktree, nama, peran, prompt sistem, dan model sendiri.

Ini proyek eksperimen pribadi, bukan jawaban atas masalah yang sedang dirasakan. Pemiliknya jarang menjalankan banyak agent, tapi ingin mencobanya dan terus memakainya. Konsekuensinya: kualitas pemakaian harian lebih penting daripada kelengkapan fitur.

Dua hal yang harus terasa bagus saat pertama dibuka:
1. Sekilas langsung tahu tiap agent sedang mengerjakan apa.
2. Chat dengan agent semudah chat biasa.

Referensi rasa: **Sokudo IDE** (landing page https://ide-landing-page.pages.dev/), yang menghubungkan tool AI coding lokal, menjalankan agent paralel, dan memberi peran per agent. Tampilan chat-nya belum pernah dilihat langsung; jangan ditiru persis, buat UI orisinal.

## 2. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Spawn, pantau, dan chat dengan banyak agent dari satu jendela.
- Chat memakai UI sendiri (gelembung pesan, baris tool, kartu persetujuan), bukan terminal.
- Status agent di sidebar dan kantor berasal dari proses nyata.
- Tiap agent bekerja di worktree dan branch sendiri.
- Izin per peran benar-benar ditegakkan.

**Bukan-tujuan (versi pertama)**
- Codex (belum terpasang, tidak ada langganan ChatGPT). Arsitektur menyisakan tempat untuk jenis agent baru.
- Papan Kanban.
- Tinjauan diff dan merge otomatis. Zonder tidak pernah merge sendiri.
- Installer. Hanya dibuat setelah alur nyata terbukti jalan.
- IDE atau editor kode.
- Multi-platform, sinkronisasi cloud, 9router tertanam.

**Anti-tujuan (gagal walau secara teknis jalan)**
- Kantor hanya dekorasi yang tidak mencerminkan proses nyata.
- Agent bisa mengubah checkout utama tanpa persetujuan.
- Tidak jelas agent mana memakai model apa.
- Aplikasi terasa berat atau lambat.
- Chat kehilangan riwayat saat aplikasi ditutup.

## 3. Jenis agent versi pertama

### 3.1 Claude Code (lokal, langganan yang sudah login)
Terbukti lewat percobaan pada Claude Code 2.1.316 di mesin ini:
- Proses: `cmd.exe /d /s /c claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode manual --permission-prompt-tool stdio --model <m>`, `cwd` = worktree agent. Hanya `claude.cmd` yang ada, tidak ada `claude.exe`, jadi lewat `cmd.exe` wajib.
- Satu proses = satu sesi persisten. Pesan pengguna dikirim ke stdin sebagai JSON `{"type":"user","message":{"role":"user","content":"..."}}` per baris. Memori antargiliran terbukti bertahan (3 giliran, satu proses).
- Keluaran: JSON per baris (`system`, `assistant` dengan blok `text`/`thinking`/`tool_use`, `user` dengan `tool_result`, `result`, `control_request`). Dari sini gelembung chat, baris tool, dan status dibangun.
- Izin: dengan `--permission-prompt-tool stdio`, Claude mengirim `control_request` subtipe `can_use_tool` (nama tool + input) dan menunggu `control_response` `{behavior:'allow', updatedInput}`. Allow terbukti membuat file. Tanpa flag itu, izin ditolak otomatis. Balasan `deny` belum diuji; wajib diuji saat implementasi.
- Prompt sistem/persona lewat `--append-system-prompt` (jangan `--system-prompt`, supaya perilaku dasar Claude Code tetap). Jangan pernah memakai `--dangerously-skip-permissions`.
- Dilarang: PTY, `node-pty`, xterm.js. Tidak diperlukan.
- Giliran pertama butuh ±5–7 detik sebelum keluaran muncul (start proses + hook milik pengguna). UI harus menampilkan status "starting" yang jujur.
- Hook global milik pengguna (mis. `localhost:47821`) ikut jalan di tiap sesi dan bisa mengeluh ke stderr saat sesi berakhir. Abaikan stderr jenis itu; jangan jadikan status error.

### 3.2 Agent 9router (HTTP langsung)
- Base URL: `https://20128-agqzdjehcbqqxt5op7nul4teau.instabox.tech/v1` (dapat diubah di pengaturan). Model: `GET /v1/models`. Chat: `POST /v1/chat/completions` (streaming), dengan `Authorization: Bearer <key>`.
- API key disimpan lewat Electron `safeStorage`, tidak pernah di config teks biasa.
- 9router hanya merutekan. Zonder yang menjalankan tool (baca file, tulis file, jalankan perintah) secara lokal di dalam worktree agent, lewat loop `tool_calls` → eksekusi → `role: tool`. Set tool awal minimal: `read_file`, `list_dir`, `write_file`, `run_command`.
- Kompresi RTK otomatis di sisi 9router. Tidak butuh header khusus. Jangan bergantung pada endpoint dashboard.
- Jika router tidak terjangkau, agent 9router masuk status `error` dengan pesan "Router offline".

### 3.3 Antarmuka seragam
Satu kontrak internal untuk semua jenis agent, supaya UI tidak peduli sumbernya: menerima pesan pengguna, memancarkan event (`message`, `tool_start`, `tool_end`, `approval_request`, `status`, `error`, `exit`), menerima keputusan izin, dan bisa dihentikan. Codex nanti = implementasi ketiga. Jangan menambah abstraksi lain dari ini.

## 4. Worktree Git

- Pilih workspace → validasi itu repo Git sebelum spawn.
- Worktree: `<induk-proyek>/.zonder-worktrees/<agent-id>`, di luar pohon repo. Branch: `zonder/<slug-aman>-<id-pendek>`. Slug dan nama harus bebas tabrakan.
- Setiap agent bekerja hanya di worktree-nya; tidak pernah di checkout utama.
- Saat agent dihentikan, tawarkan: pertahankan worktree / hapus worktree saja / hapus worktree dan branch. Tidak pernah merge otomatis.
- Pembuatan dan pembersihan worktree wajib punya tes dengan repo sementara.

## 5. Kebijakan izin

Peran: Senior Developer, Junior Developer, Reviewer, QA Engineer, Researcher, Custom. Tiap peran punya prompt bawaan yang bisa diedit sebelum spawn.

Aturan dasar (ditegakkan, bukan label UI):
- Reviewer, Researcher: hanya baca. Tidak ada tulis, perintah yang mengubah, atau Git write.
- QA: boleh menjalankan tes; tidak mengedit kode produksi secara default.
- Junior: edit dan perintah butuh persetujuan.
- Senior: edit di worktree dan perintah tes yang aman otomatis; install paket, Git push, hapus, dan akses rahasia selalu bertanya.
- **Semua peran, tidak bisa di-override:** akses checkout utama, force push, penulisan ulang riwayat, file kredensial, dan path di luar worktree diblokir.

**Tingkat penegakan (disetujui pengguna): sebaik mungkin.** Tool file diperiksa secara terstruktur (path dinormalisasi dan harus berada di dalam worktree). Perintah shell hanya dikenali lewat daftar aman yang konservatif; apa pun yang tidak dikenali menjadi `ask` (atau `deny` untuk peran hanya-baca). Reviewer dan Researcher tidak mendapat shell sama sekali. Tidak ada sandbox tingkat sistem operasi di versi pertama; UI dan dokumentasi tidak boleh mengklaim isolasi penuh.

Satu fungsi murni `decide(peran, aksi, worktree)` → `allow | deny | ask`, dengan tes berbasis tabel termasuk validasi path (traversal, symlink, huruf drive berbeda, UNC).

Alur persetujuan (sama untuk semua jenis agent):
1. Agent meminta aksi (Claude: `control_request`; 9router: `tool_calls`).
2. Proses utama menjalankan `decide`.
3. `allow` → jalankan/izinkan. `deny` → kembalikan hasil tool berisi alasan penolakan. `ask` → kirim permintaan terstruktur ke renderer.
4. Renderer menampilkan kartu: **Izinkan sekali / Izinkan untuk sesi ini / Tolak**. Status agent menjadi `approval` dan avatar ke meeting pod.
5. Renderer tidak pernah menjalankan perintah atau menyentuh filesystem.

Catatan penting: untuk Claude, jalur yang sama (`can_use_tool`) berarti Zonder yang memutuskan, bukan pengaturan izin Claude saja. Pengaturan izin Claude (`--permission-mode manual`) tetap dipakai sebagai lapisan kedua.

## 6. UI

Gaya: gelap, padat, alat pengembang. Tanpa gradien berlebihan atau glassmorphism. Pakai bilah judul Windows asli (tidak frameless).

- **Sidebar kiri, tetap 220px:** daftar agent (avatar, nama, model, status), tombol Spawn Agent, status koneksi 9router.
- **Tengah:** kantor isometrik di Canvas 2D (lihat bagian 7).
- **Kanan, tetap 340px:** tab per agent; pesan streaming; baris tool; pemilih model; kartu persetujuan; input pesan.
- **Bilah status bawah:** koneksi router, jumlah agent aktif, status RTK (hanya dari data nyata; tampilkan "—" bila tidak diketahui).
- **Modal Spawn:** nama, peran, prompt (bisa diedit), jenis agent + model, workspace (folder Git), branch dasar.

Dari Sokudo yang diambil: chat bergaya sendiri, daftar agent berstatus, peran per agent. Kanban dilewatkan.

Mockup tata letak: `C:\Users\ARIEF\AppData\Local\hermes\cache\scratch\agent-desk-mockup.html` (acuan tata letak dan palet saja; jangan salin emoji/sprite CSS-nya).

## 7. Kantor isometrik (versi hemat)

Satu ruangan. Pemetaan status → zona:

| Status | Zona |
|---|---|
| working | kluster meja |
| thinking | papan tulis |
| approval | meeting pod |
| testing | stasiun QA |
| done | lounge |
| idle | coffee bar |
| error | meja dengan penanda merah jelas |

Status `testing` hanya ditampilkan bila benar-benar diketahui (mis. agent menjalankan perintah tes yang dikenali); jika tidak, jangan ditebak.

Teknis:
- Canvas 2D, loop `requestAnimationFrame`, `imageSmoothingEnabled = false`. Tanpa WebGL dan tanpa React untuk kantor.
- Pisahkan grid logis dan pathfinding dari proyeksi isometrik. Urutan gambar memakai Y kaki hasil proyeksi.
- ID zona dan kursi eksplisit di data peta (mis. `desk.A1`), tidak lagi memindai piksel.
- Sumber adaptasi: `D:\pixel-agent-desk\src\office\` (`office-renderer`, `office-character`, `office-pathfinder`, `office-config`, `office-sprite`). Pakai ulang loop, mesin keadaan karakter, dan pathfinder; lisensi MIT. Aset sprite-nya boleh dipakai ulang bila terbukti cocok, bila tidak buat avatar sederhana.
- Furnitur: bentuk geometris warna solid, tanpa gradien.
- Klik avatar = fokus ke chat agent itu. Perpindahan antar zona berjalan mulus, bukan teleport.
- Bagian ini sengaja tidak boleh menjadi pekerjaan terbesar.

## 8. Keamanan Electron

- `contextIsolation: true`, `nodeIntegration: false`, preload + `contextBridge`.
- API renderer sempit dan bertipe: `listAgents`, `spawnAgent(config tervalidasi)`, `stopAgent(id)`, `sendMessage(id, teks)`, `respondApproval(requestId, keputusan)`, `selectWorkspace`, `subscribeAgentEvents(callback)`.
- Jangan ekspos `child_process`, filesystem mentah, perintah sembarang, atau IPC sembarang. Validasi semua input di proses utama.
- Semua proses anak dan HTTP berada di proses utama.

## 9. Yang berubah dari dokumen desain lama

- PTY/`node-pty`/xterm.js → mode streaming JSON.
- `keytar` → `safeStorage`. Bilah judul kustom bergaya macOS → bilah judul Windows asli. `child_process` mentah dan worktree `.zonder/` di dalam repo → worktree saudara `.zonder-worktrees`.
- Codex dan Kanban keluar dari versi pertama.

## 10. Urutan pengerjaan (usulan, dirinci di rencana)

1. Kerangka Electron + tiga kolom dengan data tiruan.
2. Model agent/sesi + event + mesin keadaan status.
3. Worktree: buat/hentikan, dengan tes.
4. Agent Claude nyata: spawn, kirim pesan, stream ke chat, status dasar, stop bersih.
5. Kebijakan izin + kartu persetujuan (uji allow **dan deny**).
6. Kantor isometrik terhubung ke status nyata.
7. Modal Spawn lengkap dan persona.
8. Agent 9router dengan loop tool lokal.
9. Pengemasan installer, hanya setelah alur nyata terbukti.

Setiap tahap dijalankan lokal dan hasil nyatanya dilaporkan.

## 11. Batasan dan lingkungan

- Windows 10/11 x64. Node 24.3, npm 11.4, Git 2.54 sudah ada. Claude Code 2.1.316 login langganan (CLI dan desktop). Tidak ada Visual Studio Build Tools (tidak diperlukan lagi tanpa `node-pty`).
- Folder proyek: `D:\Code\Project\Zonder-app` (kosong, belum repo Git).
- 9router: API key sudah dimiliki pengguna; endpoint remote harus terjangkau dari mesin.
- Minim dependensi; tidak menambah abstraksi tanpa kebutuhan. Tes memakai `node:test`.

## 12a. Keputusan penulis desain (bukan hasil kesepakatan; bisa diubah)

- **Tool tak dikenal:** `decide()` memberi `ask` untuk tool yang tidak dikenali (termasuk tool MCP). Agent Claude dijalankan dengan `--strict-mcp-config` agar MCP/plugin global pengguna tidak ikut terbawa.
- **Setelah aplikasi ditutup:** menutup jendela menghentikan semua proses anak dan menandai agent `stopped`. Riwayat chat, registri agent (peran, model, worktree, `session_id` Claude) tersimpan di disk. Saat dibuka lagi, agent bisa dilanjutkan: Claude lewat `--resume <session_id>`, 9router lewat memutar ulang riwayat pesan. Worktree yatim ditawari pembersihan lewat dialog yang sama dengan Stop.
- **"Izinkan untuk sesi ini":** berlaku per agent selama aplikasi berjalan, untuk tool yang sama dengan pola perintah/path yang sama. Tidak pernah menimpa blokir keras maupun aksi "selalu bertanya" (install, push, hapus, rahasia).
- **Pesan saat agent sedang bekerja:** pengguna boleh mengetik; pesan masuk antrean dan dikirim setelah giliran selesai. Ada tombol Interupsi yang menghentikan giliran tanpa mematikan proses. Antarmuka agent (3.3) mendapat metode `interrupt`.
- Daftar perintah tes otomatis, pola file kredensial, dan kapan `done` kembali ke `idle`: diputuskan pembangun.

## 12. Diserahkan kepada pembangun

- Desain piksel tile/avatar dan animasi.
- Algoritma pathfinding (boleh pakai ulang yang ada).
- Skema event IPC dan format penyimpanan riwayat chat (harus bertahan setelah aplikasi ditutup; lokasi dan format bebas).
- Heuristik pembedaan `working` / `thinking` dari aliran event Claude (mis. `thinking` blok vs `tool_use`).
- Daftar model Claude yang ditawarkan (`--model`).
- Struktur kode dan bahasa pemrograman renderer (JavaScript biasa disarankan).
