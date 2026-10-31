# Zonder: DESIGN.md

Arah visual untuk UI Zonder. Dipakai bersama `antislop` (filter) saat membangun renderer.

**Status arahan:** pemilik meminta Zonder bertema gelap dan "seperti UI Sokudo" (R-30: meniru produk lain boleh karena diminta eksplisit). Referensi diamati dari [landing page Sokudo IDE](https://ide-landing-page.pages.dev/), yaitu tangkapan layar aplikasinya, bukan aplikasi sebenarnya. Yang ditiru adalah **bahasa visual**: hitam netral, kartu membulat dengan batas tipis, composer berkartu, kartu status agent. Logo, nama, teks, dan gradien ungu di sekeliling landing page-nya tidak ditiru. Item bertanda **(tebakan)** adalah pilihan agent; pemilik boleh mengganti.

Design Read: *Reading this as: desktop agent workbench for one technical owner, in a Sokudo-like neutral dark style, dial ENERGY 1 / RHYTHM 1 / MOTION 1.*

Dial: ENERGY 1 / RHYTHM 1 / MOTION 1 **(tebakan)**
- ENERGY 1: alat kerja yang dibuka berjam-jam.
- RHYTHM 1: tiga kolom tetap (220 / fleksibel / 340); keseragaman disengaja. Variasi hidup di kantor isometrik.
- MOTION 1: gerak hanya untuk status nyata (avatar berpindah, teks streaming, kartu izin muncul).

## Yang diamati dari Sokudo

- Hitam netral hampir murni (tanpa semburat biru), panel sedikit lebih terang, batas 1px tipis.
- Kiri: tombol "New Chat" lebar penuh berbingkai, di bawahnya daftar bergrup tanggal dalam teks kecil.
- Tengah: judul tengah "What you want to build today?" dan **composer berkartu**: placeholder di atas, baris bawah berisi mode (Build), pemilih model ("Claude Code CLI · claude-opus-4-7"), Attach, dan tombol kirim bulat.
- Atas tengah: sakelar segmen dua pilihan (Chat | File Changes).
- Kanan: bagian "Current Tasks" dan "Agents Status", berisi kartu kecil per agent (nama, status satu baris, penanda kecil di kanan).
- Sudut membulat sedang (sekitar 8-12px), tanpa bayangan berat, tanpa gradien di dalam aplikasi.

## Adaptasi untuk Zonder

Sokudo menaruh chat di tengah; Zonder menaruh kantor di tengah dan chat di kanan (tata letak dari brief). Bahasa visualnya dipindahkan:

- **Composer berkartu** di panel chat kanan: textarea, lalu baris bawah dengan pemilih model, Attach (tidak di versi pertama; jangan tampilkan bila tidak berfungsi, R-26), indikator antrean, tombol kirim bulat, dan tombol Interupsi saat agent bekerja.
- **Sakelar segmen** di atas kantor: Office | Grid.
- **Sidebar kiri:** tombol "Spawn Agent" lebar penuh berbingkai di atas daftar, lalu **kartu agent kecil** (titik status, nama, model mono, status satu baris) seperti kartu "Agents Status".
- **Keadaan kosong:** judul tengah "Apa yang ingin dikerjakan?" bila belum ada agent, dengan tombol Spawn Agent. Tanpa agent karangan.

## Warna

Inti: dua permukaan netral + teks. Aksen: satu biru. Warna status adalah sistem makna.

| Token | Nilai | Dipakai untuk | Kontras teks di atas `--surface` |
|---|---|---|---|
| `--bg` | `#0b0b0c` | latar aplikasi, canvas | n/a |
| `--surface` | `#131314` | sidebar, panel chat | n/a |
| `--surface-2` | `#1b1b1d` | kartu, composer, hover | n/a |
| `--border` | `#2a2a2d` | garis dan bingkai kartu (dekoratif) | 1.30 |
| `--text` | `#ececee` | teks utama | 15.74 |
| `--muted` | `#9a9aa2` | teks sekunder | 6.65 |
| `--accent` | `#0a6cd6` | tombol utama (teks putih 5.09) | n/a |
| `--accent-text` | `#4da3ff` | tautan, fokus, agent terpilih | 7.07 |

Status (titik + teks, selalu keduanya):

| Status | Warna | Kontras di atas `--surface` |
|---|---|---|
| working | `#4da3ff` | 7.07 |
| thinking | `#a78bfa` | 6.82 |
| approval | `#f59e0b` | 8.65 |
| testing | `#2dd4bf` **(tebakan)** | 9.98 |
| done | `#22c55e` | 8.15 |
| error | `#f87171` | 6.71 |
| idle / stopped / starting | `--muted` | 6.65 |

Alasan: status yang berbeda harus terbedakan sekilas (tujuan utama pemilik); melebihi batas 2-3 warna inti sebagai sistem status yang terdokumentasi (R-29). Tidak ada gradien, glow, atau glassmorphism di dalam aplikasi; gradien ungu di sekitar mockup Sokudo tidak ditiru.

Tema: hanya gelap, permintaan pemilik. Tidak ada tombol tema, jadi tidak ada mode kedua yang bisa rusak (R-21, R-34).

## Tipografi

- UI: `Segoe UI Variable`, `Segoe UI`, sans-serif. Font sistem Windows, tajam di ukuran kecil **(tebakan)**.
- Kode, nama model, path, perintah: `Cascadia Code`, `Consolas`, monospace.
- Ukuran: 12px isi chat dan daftar, 11px metadata, 13px judul panel, 20px hanya untuk judul keadaan kosong. Tidak ada teks di bawah 11px. Tidak ada label huruf kapital berjarak lebar.

## Bentuk dan kedalaman

- Radius: 8px kartu, composer, dan kartu agent; 6px tombol dan input; titik dan tombol kirim bulat penuh. Tidak ada kapsul untuk lencana.
- Bingkai 1px `--border` sebagai pembeda utama. Bayangan hanya pada kartu izin dan menu mengambang.
- Kepadatan: kartu agent sekitar 52px, jarak antarpesan 10px, padding panel 12px.

## Komponen kunci

- **Kartu agent:** titik status, nama, model mono, satu baris status. Terpilih: bingkai `--accent-text` 1px dan latar `--surface-2`.
- **Pesan chat:** pengguna di kanan dengan latar `--surface-2`; agent di kiri tanpa bingkai berat. Blok kode: latar `--bg`, mono.
- **Baris tool:** satu baris tertutup (nama tool + ringkasan), bisa dibuka untuk input dan output. Warna `--muted`.
- **Kartu izin:** judul aksi, perintah/path dalam blok mono, satu baris alasan, tiga tombol: **Izinkan sekali**, **Izinkan untuk sesi ini**, **Tolak**. Bingkai amber 1px; hanya di sini amber menjadi bingkai.
- **Bilah status:** teks `--muted`, angka `--text`; nilai tidak diketahui ditulis `—`. Latar `--surface`, bukan biru.

## Kantor isometrik

- Lantai dan furnitur: bentuk geometris solid dari keluarga `--surface` / `--surface-2`, tepi lebih terang 1px. Tanpa gradien atau tekstur.
- Warna cerah dicadangkan untuk avatar dan titik status. Avatar: bentuk sederhana warna status, nama kecil, cincin `--accent-text` bila terpilih. Status `error` memakai penanda merah tegas di mejanya.
- Berjalan antar zona lewat jalur grid; berhenti saat jendela disembunyikan.

## Yang sengaja dihindari

Gradien dan cahaya ungu/biru di sekitar UI, glow, glassmorphism, lencana kapsul, emoji sebagai ikon, ikon "sparkle/AI", panah dekoratif, grid latar, teks "Get Started/Learn More". Placeholder wajib berlabel (R-23/R-38); tidak ada avatar, angka, atau statistik karangan. Fitur tampil di UI hanya bila berfungsi (Kanban, Canvas, Wiki, Docker, dan Attach milik Sokudo tidak ada di Zonder).

## Ikon

Set ikon kecil kustom atau teks bila cukup jelas **(tebakan)**. Tiap ikon relevan (terminal untuk perintah, berkas untuk baca/tulis, cabang untuk Git); bila tidak ada yang tepat, pakai teks.
