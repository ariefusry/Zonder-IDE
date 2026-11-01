# Zonder: Header dan halaman Settings

Tanggal: 2026-11-01. Melengkapi `2026-11-01-zonder-design.md`; bagian yang tidak disebut di sini tetap mengikuti dokumen itu.

## 1. Maksud dan alasan

Pemilik ingin satu tempat untuk mengatur semua hal di Zonder, dibuka dari header di bagian atas jendela, seperti contoh yang ia tunjukkan (deretan ikon kecil di kanan atas, ikon roda gigi membuka halaman Settings dengan menu di kiri dan kartu-kartu pengaturan di kanan).

Saat ini pengaturan tersebar dan sebagian tidak bisa diubah sama sekali:
- Koneksi 9router hanya lewat tombol kecil di kiri bawah sidebar.
- Peran (role) tertanam di kode: persona dan hak aksesnya tetap, dan tidak ada cara menambah peran baru. Pemilik ingin, misalnya, peran **Designer** yang membuat desain website.
- Skill Claude Code pemilik (`~/.claude/skills` dan plugin) tidak terlihat di Zonder. Agent Claude memuat semuanya diam-diam; agent 9router tidak bisa memakainya sama sekali.
- Model Claude hanya tiga alias (`opus`, `sonnet`, `haiku`); effort tidak bisa dipilih untuk jenis agent mana pun.

Pemilik belum mencoba banyak dari ini langsung, jadi versi pertama memakai default sederhana yang bisa disesuaikan setelah dipakai.

## 2. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Header di atas tiga kolom dengan deretan ikon; ikon roda gigi membuka halaman Settings.
- Halaman Settings dengan menu kiri: **Providers, Roles, Skills, Workspace, Agent, Notifikasi**.
- Peran bisa diedit (persona, izin, skill) dan ditambah; peran buatan pemilik bisa dihapus.
- Skill dipilih per peran; agent 9router bisa memakai skill lewat tool.
- Semua versi model Claude bisa dipilih, plus ID model bebas; effort bisa dipilih untuk Claude dan 9router.

**Bukan-tujuan (versi ini)**
- Tema terang, pilihan font, shortcut keyboard. Aturan tetap: dark only; font masih ditunda.
- Codex atau CLI lain, Kanban, installer (tetap di luar scope).
- Tab Knowledge Base, Rules, Memory, Wiki dari gambar contoh.
- Mengubah peran agent yang sedang berjalan.
- Pembatasan izin per jenis file untuk peran baru (misalnya "Designer hanya `*.css`"). Bisa menyusul setelah dipakai.

**Anti-tujuan (gagal walau secara teknis jalan)**
- Pengaturan apa pun yang membuka blokir keras: file kredensial, checkout utama, path di luar worktree, force push, tulis ulang riwayat. Ini tidak boleh muncul sebagai pilihan.
- API key 9router terlihat di renderer, di file teks biasa, atau di log.
- Pengaturan yang tampak berlaku padahal diabaikan tanpa keterangan (misalnya centang skill untuk agent Claude yang tidak berefek, tanpa pemberitahuan).
- UI yang meniru produk lain sampai menyalin merek atau ikonnya.

## 3. Batasan

- Mengikuti aturan proyek: tes dulu, satu commit per tugas, tanpa dependensi baru, tanpa PTY/node-pty/xterm, dark theme, aturan antislop.
- Keamanan Electron tetap (dokumen utama §8): API renderer sempit dan bertipe, validasi di proses utama, renderer tidak menyentuh filesystem. Membaca daftar skill dan isi file skill dilakukan di proses utama.
- Bilah judul Windows asli tetap dipakai (dokumen utama §6). Header adalah baris di dalam jendela, bukan bilah judul kustom.
- Kebijakan izin tetap fungsi murni `decide`. Peran berubah dari daftar tetap menjadi data, tapi aturan blokir keras tetap di kode.
- Pekerjaan ini dikerjakan **setelah Tugas 12** (quit, relaunch, resume) dari rencana yang ada.

## 4. Yang sudah diputuskan

### 4.1 Header
- Baris tipis di atas sidebar, kantor, dan chat, selebar jendela.
- Kanan: deretan ikon dalam satu wadah membulat, seperti contoh. Minimal ikon **Settings** (roda gigi). Ikon lain hanya bila punya fungsi nyata di Zonder; tidak ada ikon hiasan.
- Settings terbuka sebagai halaman penuh yang menggantikan tiga kolom, dengan tombol kembali (panah kiri + "Settings") di kiri atas, seperti contoh. Agent tetap berjalan di latar.

### 4.2 Providers
- **9router:** URL endpoint dan API key, tombol "Simpan dan periksa", status terhubung/terputus, latensi, jumlah model. Perilakunya sama dengan dialog 9router sekarang (Tugas 11): kunci tidak pernah kembali ke renderer; isian kunci kosong mempertahankan kunci tersimpan.
- Tombol 9router di sidebar tetap menampilkan status, dan mengkliknya membuka Settings → Providers (dialog lama dihapus).
- **Claude Code CLI:** status terpasang/tidak, versi (`claude --version`), dan sudah login atau belum, plus tombol "Periksa ulang". Tanpa isian; login tetap lewat CLI.

### 4.3 Roles
- Daftar semua peran: bawaan (Senior Developer, Junior Developer, Reviewer, QA Engineer, Researcher, Custom) dan buatan pemilik.
- Tiap peran bisa diedit: **nama** (hanya peran buatan), **persona**, izin **Tulis file**, izin **Shell**, dan **skill**.
- Tombol **Tambah peran**. Default peran baru: tulis "tanya dulu", shell "tanya dulu", tanpa skill.
- Peran bawaan bisa diedit dan dikembalikan ke default, tidak bisa dihapus. Peran buatan bisa dihapus.
- Perubahan berlaku untuk agent yang di-spawn sesudahnya. Agent yang sedang jalan tetap memakai aturan saat ia di-spawn.
- **Agent yang di-resume** setelah restart (Tugas 12) memakai aturan peran **saat ini**, supaya peran yang diperketat langsung berlaku. Bila peran buatannya sudah dihapus, agent memakai salinan aturan yang tersimpan di recordnya dan diberi tanda "peran dihapus". Record lama yang hanya berisi nama peran memakai aturan peran bawaan dengan nama itu.
- Blokir keras berlaku untuk semua peran dan tidak tampil sebagai pilihan. Install paket, git push, dan hapus selalu bertanya.
- Disimpan di `roles.json` di folder data Zonder.

### 4.4 Skills
- Halaman Skills menampilkan semua skill yang ditemukan: dari `~/.claude/skills` dan dari plugin yang terpasang. Per skill: nama, deskripsi, sumber.
- Skill dipilih **per peran** (di editor peran), bukan per agent.
- **Agent 9router:** mendapat tool `load_skill`. Prompt sistem memuat daftar nama + deskripsi skill perannya; isi skill dimuat saat agent memanggil tool itu. Membaca file skill dilakukan proses utama dan dibatasi ke skill yang dipilih untuk peran itu.
- `load_skill` menerima nama skill dan path relatif opsional di dalam folder skill itu (default `SKILL.md`), sehingga agent bisa membaca file pendukung seperti `references/*.md` atau template. Hanya baca. Path divalidasi ketat (traversal, symlink, huruf drive, UNC) agar tidak keluar dari folder skill, dengan tes tabel sendiri. File kredensial tetap diblokir.
- Script di folder skill tidak bisa dijalankan: blokir shell "di luar worktree" tetap berlaku.
- **Agent Claude:** pembatasan per skill bergantung pada kemampuan CLI. CLI v2.1.316 hanya punya `--disable-slash-commands` (mematikan semua skill dan perintah). Lihat §5.

### 4.5 Workspace
- Folder repo default (dipakai mengisi modal Spawn).
- Base branch default (sekarang `main`).
- Pilihan default saat Stop agent: simpan worktree / hapus worktree / hapus worktree+branch.

### 4.6 Agent: model dan effort
- **Claude, model:** daftar berisi alias (`opus`, `sonnet`, `haiku`) dan semua versi yang dikenal, termasuk `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, dan versi lama seperti `claude-opus-4-7` dan `claude-haiku-4-5`. Ditambah isian **ID model lain** agar versi baru bisa dipakai tanpa update Zonder. Dikirim lewat `--model`.
- **Claude, effort:** `low`, `medium`, `high`, `xhigh`, `max`, lewat `--effort` (ada di CLI v2.1.316).
- **9router, model:** dari daftar `/models` router.
- **9router, effort:** `low`, `medium`, `high`, dikirim sebagai `reasoning_effort`. Router atau model yang tidak mendukung akan mengabaikannya; UI menyebut bahwa efeknya bergantung pada model.
- Default per jenis agent diatur di Settings → Agent, dan bisa diganti di modal Spawn.
- Effort bisa diganti untuk agent yang sedang jalan, seperti model sekarang. Untuk Claude, ini memulai ulang proses agent dengan sesi yang sama (`--resume`).
- Batas putaran tool 9router (sekarang 25) dan batas waktu `run_command` (sekarang 60 detik) bisa diatur, dengan batas bawah dan atas yang wajar.

### 4.7 Notifikasi
- Alert desktop saat agent minta izin, selesai, atau error. Masing-masing bisa dinyalakan/dimatikan.
- Alert menyebut nama agent dan jenis kejadian, tidak menyertakan isi pesan agent.

## 5. Keputusan penulis desain (bukan hasil kesepakatan; bisa diubah)

- **Arti izin "langsung" untuk Shell** mengikuti perilaku Senior sekarang: perintah tes dan Git baca yang dikenali berjalan otomatis; perintah lain tetap bertanya. Shell tanpa batas tidak ditawarkan, sesuai prinsip penegakan "sebaik mungkin" di dokumen utama §5. Jadi pilihan Shell: **tidak boleh / tanya dulu / otomatis untuk tes & Git baca**.
- **Pilihan Tulis file:** **tidak boleh / hanya file tes / tanya dulu / langsung**. "Hanya file tes" adalah aturan QA yang sudah ada. Hapus file selalu bertanya.
- Peran bawaan dipetakan ke pilihan itu sesuai aturan sekarang (Senior: langsung + otomatis; Junior: tanya + tanya; QA: hanya file tes + otomatis; Reviewer/Researcher: tidak boleh + tidak boleh; Custom: tanya + tanya). Perilaku `decide` untuk peran bawaan yang tidak diedit harus sama persis dengan sekarang; tes tabel yang ada tetap lulus.
- Izin, persona, dan skill peran **disalin ke record agent saat spawn**. `decide` membaca salinan itu, sehingga mengedit atau menghapus peran tidak mengubah agent yang sudah jalan. Salinan ikut disimpan di record agent; saat resume, salinan diganti aturan peran saat ini (§4.3), kecuali perannya sudah dihapus.
- **Skill untuk agent Claude:** bila pembuat menemukan cara CLI untuk membatasi skill tertentu, centang skill berlaku untuk Claude. Bila tidak, editor peran menampilkan keterangan bahwa centang skill hanya berlaku untuk agent 9router, dan agent Claude tetap memuat semua skill pemilik. Opsi "matikan semua skill" (`--disable-slash-commands`) per peran boleh ditawarkan.
- Pengaturan aplikasi (workspace, agent, notifikasi) disimpan di `settings.json` di folder data Zonder, terpisah dari `roles.json`, `router.json`, dan `router-key.bin`.
- Header hanya berisi ikon Settings sampai ada fungsi lain yang nyata.
- **Ganti effort agent Claude saat sibuk:** perubahan disimpan dan baru diterapkan (restart dengan `--resume`) setelah giliran berjalan selesai dan tidak ada persetujuan yang menunggu. UI menampilkan "berlaku setelah giliran ini". Tidak ada pekerjaan yang diputus. Bila agent sedang idle, restart langsung.

## 6. Diserahkan kepada pembangun

- Tata letak persis header dan halaman Settings, mengikuti gambar contoh pemilik dan palet Zonder yang ada.
- Cara menemukan skill plugin (struktur folder cache plugin), selama hanya membaca dan tetap di proses utama.
- Format `roles.json` dan `settings.json`, termasuk migrasi bila file belum ada.
- Rentang batas putaran tool dan batas waktu `run_command`.
- Cara memeriksa status login Claude CLI tanpa memicu proses login.
- Pembagian ke tugas-tugas rencana. Usulan urutan: (1) header + kerangka Settings + Providers, (2) Roles, (3) Skills, (4) Workspace, Agent (model/effort), Notifikasi.
