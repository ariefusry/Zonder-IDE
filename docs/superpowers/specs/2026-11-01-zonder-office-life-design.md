# Zonder: Kantor yang hidup

Tanggal: 2026-11-01. Mengganti sebagian §7 `2026-11-01-zonder-design.md` (kantor isometrik "versi hemat"). Yang tidak disebut di sini tetap mengikuti §7 itu.

## 1. Maksud dan alasan

Pemilik merasa kantor sekarang kurang hidup: "hanya kotak-kotak dan orang yang berjalan ke kotak". Ia ingin melihat sekilas dan langsung paham apa yang sedang dikerjakan tiap agent, dari pose dan perabot yang terasa nyata. Contohnya, saat bekerja agent duduk di depan komputer, saat berpikir ia di ruang rapat, dan saat santai ia minum kopi.

Pemilik memilih gaya **ilustrasi datar (vektor)**: bentuk halus dan membulat, perabot lebih detail. Ia menolak gaya pixel art. Mockup yang dipilih ada di `.superpowers/brainstorm/1761-1793518470/content/office-style.html`, opsi B. Mockup itu acuan gaya dan pose, bukan tata ruang, karena digambar dari depan, bukan isometrik.

## 2. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Tiap status punya pose dan animasi sendiri yang bisa dikenali tanpa membaca label.
- Perabot yang terbaca sebagai benda nyata, bukan balok.
- Kantor tetap terasa hidup walau tidak ada agent yang berubah status.

**Bukan-tujuan**
- File gambar atau sprite sheet, WebGL, library animasi. Semua digambar di kode dengan Canvas 2D.
- Beberapa ruangan, kamera yang bisa digeser atau di-zoom, atau perabot yang bisa diatur pemilik.
- Suara.

**Anti-tujuan**
- Animasi yang menyiratkan status palsu, misalnya agent tampak mengetik padahal statusnya idle, atau status `testing` ditebak (aturan §7 tetap berlaku).
- "Menunggu izin" kalah mencolok dibanding animasi lain. Itu satu-satunya status yang butuh pemilik.
- Kantor membuat app terasa berat: animasi patah-patah, atau CPU tinggi saat diam.
- Emoji sebagai sprite, atau gradien dan glassmorphism (aturan dark/antislop).

## 3. Batasan

- Canvas 2D, `requestAnimationFrame`, tanpa dependensi baru, tanpa file aset. Proyeksi, pathfinding, peta zona dan kursi (`iso.js`, `pathfinder.js`, `map.js`) tetap dipakai; tes yang ada tetap lulus.
- Status dan zona tetap berasal dari event proses yang nyata (`STATUS_TO_ZONE`).
- Warna status dari token `--st-*` yang sudah ada. Perabot dan ruangan memakai palet benda nyata seperti di mockup B (kayu coklat, hijau tanaman, papan tulis krem, aksen oranye), didefinisikan sebagai token CSS baru `--office-*` di `styles.css`, bukan hex lepas di kode kantor.
- **Baju avatar berwarna status**, seperti di mockup B (biru bekerja, ungu berpikir, hijau santai, dan seterusnya). Ini tetap menjadi petunjuk status utama di samping pose. Kulit dan rambut diturunkan dari id agent.
- Klik avatar tetap memilih agent; jalan antar zona tetap mulus.
- Dikerjakan sebagai Tugas 20, setelah Tugas 19 di `docs/superpowers/plans/2026-11-01-zonder-settings.md`.
- Klausul §7 lama "furnitur bentuk geometris warna solid" dan "bagian ini sengaja tidak boleh menjadi pekerjaan terbesar" dicabut oleh permintaan pemilik ini. Kerjanya tetap dibatasi satu tugas.

## 4. Yang sudah diputuskan

### 4.1 Pose dan animasi per status

| Status | Zona | Pose dan animasi |
|---|---|---|
| working | meja | Duduk di kursi menghadap monitor; tangan bergantian mengetik; layar biru berpendar pelan. |
| thinking | papan tulis di area ruang rapat | Berdiri menghadap papan tulis, satu tangan terangkat; gelembung tiga titik berkedip bergiliran. |
| idle, starting | coffee bar | Berdiri memegang cangkir, sesekali menyeruput; uap naik dari cangkir. |
| approval | meja rapat | Berdiri dan mengangkat tangan; gelembung "!" kuning yang berdenyut. Paling mencolok di ruangan. |
| testing | stasiun QA | Duduk menghadap dua layar; bar progres berjalan dan baris log bergulir. Tidak ada centang atau silang: Zonder hanya tahu test sedang berjalan, bukan hasilnya, jadi silang merah akan menyiratkan "test gagal" yang palsu. |
| done | lounge | Duduk bersandar di sofa; gelembung centang hijau kecil. |
| error | meja | Duduk, layar merah, tangan memegang kepala; tanda "!" merah. Warna dan bentuknya beda dari "menunggu izin". |

Papan tulis dan meja rapat berdekatan sehingga terbaca sebagai satu ruang rapat (pemilik: "berpikir di ruang rapat").

### 4.2 Kehidupan latar
- Kaki dan lengan berayun saat berjalan antar zona (tidak meluncur).
- Gerak kecil saat diam: napas (naik-turun 1 px) dan berkedip.
- Tanaman bergoyang pelan; jam dinding dengan jarum yang bergerak.

### 4.3 Perabot
Meja kerja dengan monitor dan keyboard, kursi kantor, meja rapat bundar dengan kursi, papan tulis berisi coretan, stasiun QA dengan dua layar, sofa dan meja kecil di lounge, coffee bar dengan mesin kopi dan cangkir, tanaman dalam pot, rak buku, jendela di dinding. Gaya: bentuk membulat, warna datar, tanpa gradien, garis tepi tipis bila perlu agar terbaca.

### 4.4 Tampilan
Tetap satu ruangan isometrik dengan proyeksi yang ada. Gaya B diterjemahkan ke sudut pandang isometrik.

## 5. Keputusan penulis desain (bukan hasil kesepakatan; bisa diubah)

- Empat pose (approval, testing, done, error) dan seluruh kehidupan latar diusulkan penulis karena pemilik menyerahkannya; pemilik menyetujui gambaran itu.
- Saat tab kantor tidak terlihat (jendela diminimalkan atau Settings terbuka), loop animasi berhenti atau turun ke frekuensi rendah agar CPU tetap rendah.
- Kulit dan rambut agent diturunkan secara tetap dari id agent, sehingga agent yang sama selalu terlihat sama setelah restart.
- **CPU:** ruangan statis (lantai, dinding, perabot yang tidak bergerak) digambar sekali ke canvas offscreen dan digambar ulang hanya saat ukuran berubah. Loop dibatasi 30 fps. Target terukur: dengan 3 agent diam, rata-rata CPU proses renderer di bawah 5% selama 30 detik di mesin pemilik.
- **Agent tanpa kursi** (zona penuh, berdiri di tile overflow) memakai varian berdiri dari pose statusnya, tetap dengan baju berwarna status dan tanda yang sama ("!" kuning, "!" merah, dan seterusnya). Peta tidak diubah hanya untuk menambah kursi.
- Mengubah centang/silang QA menjadi indikator netral (lihat tabel §4.1) adalah keputusan penulis demi anti-tujuan "status palsu".
- Animasi memakai waktu nyata (`dt`), bukan jumlah frame, agar kecepatannya sama di layar 60 Hz dan 144 Hz.

## 6. Diserahkan kepada pembangun

- Tata letak persis perabot di grid 16×12, selama zona dan kursi tetap terjangkau pathfinding dan papan tulis dekat meja rapat. Bila kursi berpindah, perbarui `map.js` dan tesnya.
- Struktur kode gambar (misalnya satu fungsi gambar per jenis perabot dan per pose) dan pembagian file di `src/renderer/office/`.
- Detail gerakan: amplitudo, kecepatan, dan jumlah frame pose.
- Cara menguji: logika murni (pose dari status, penampilan dari id, fase animasi dari waktu) diuji dengan `node:test`; tampilan dicek lewat screenshot CDP.
