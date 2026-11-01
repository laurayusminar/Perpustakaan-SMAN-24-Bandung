# Sistem Informasi Perpustakaan SMA Negeri 24 Bandung

Aplikasi pengelolaan perpustakaan berbasis Node.js, Express, EJS, dan SQLite. SQLite menyimpan data dalam satu file sehingga tidak memerlukan layanan database terpisah.

## Fitur

- Login petugas dengan username atau email, sesi, dan pembatasan percobaan login.
- Dashboard statistik koleksi, anggota, pinjaman aktif, serta ringkasan transaksi hari ini.
- Pencarian dan CRUD anggota, buku, kategori, dan petugas.
- Peminjaman dengan validasi stok dan batas maksimal 3 buku aktif per anggota.
- Pengembalian penuh atau sebagian dengan stok otomatis bertambah.
- Jatuh tempo 3 hari setelah tanggal pinjam; pinjaman terlambat ditandai di daftar transaksi.
- Autocomplete anggota berdasarkan nama/NIS/kelas dan buku berdasarkan judul/kode/pengarang/ISBN.
- Filter anggota berdasarkan kelas, buku berdasarkan kategori, dan transaksi berdasarkan tanggal pinjam, status, serta nama/NIS/buku.
- Export `.xlsx` untuk seluruh tabel utama; hasil ekspor mengikuti pencarian dan filter yang sedang dipakai.
- Status anggota `Aktif`, `Alumni`, atau `Keluar`; hanya anggota aktif dapat meminjam. Perubahan kelas massal tersedia untuk memindahkan seluruh anggota aktif dari satu kelas, sementara data alumni dan riwayat transaksinya tetap diarsipkan.
- Import anggota dan buku mendukung `.csv`/`.xlsx`, smart mapping nama header, strategi duplikat skip/update, validasi baris, serta template CSV yang bisa diunduh.
- Baris impor invalid/duplikat disimpan dalam antrean review per sesi petugas selama satu jam, dengan nomor baris sumber, data terpetakan, alasan, aksi edit/simpan ulang, atau abaikan.
- Katalog publik dapat dibuka tanpa login di `/katalog`, dengan pencarian real-time judul/pengarang/ISBN, filter kategori, dan informasi stok tersedia.
- Skema database tersedia pada `database/schema.sql`.

## Menjalankan lokal

1. Pasang Node.js 20 atau lebih baru.
2. Jalankan `npm install`.
3. Salin `.env.example` menjadi `.env`, lalu ubah `SESSION_SECRET` dan `ADMIN_PASSWORD`.
4. Jalankan `npm start` dan buka `http://localhost:3000` untuk katalog publik.

Katalog pengunjung berada di `/` (dialihkan ke `/katalog`) dan tidak menyediakan tautan menuju area petugas. Login petugas ada di `/admin/login`; semua dashboard, transaksi, CRUD, import, export, dan lookup berada di bawah prefix `/admin` serta dilindungi session login.

Saat database baru dibuat, aplikasi menyiapkan akun administrator dari variabel `ADMIN_*` dan beberapa kategori/buku contoh. Login pertama menggunakan nilai pada `.env` (nilai bawaan pengembangan: `admin` / `admin123!`). Ganti kredensial bawaan sebelum aplikasi dipublikasikan. Petugas tambahan dapat dibuat melalui menu Petugas. Kolom NIS ditambahkan otomatis pada database lama tanpa menghapus data.

Impor file dibatasi 5 MB dan 5.000 baris per proses. Duplikat anggota dicocokkan berdasarkan NIS, duplikat buku berdasarkan kode buku. Pilihan update mempertahankan status anggota dan mempertahankan kolom opsional buku/anggota yang tidak terdapat dalam file.

## Hosting

Jalankan sebagai aplikasi Node.js dengan `npm start` dan atur variabel lingkungan pada penyedia hosting. Pastikan platform menyediakan penyimpanan file persisten dan arahkan `DB_FILE` ke lokasi tersebut; filesystem sementara akan menghapus database saat aplikasi dimulai ulang. Gunakan HTTPS dan `SESSION_SECRET` yang kuat. Untuk beberapa instance aplikasi, SQLite lokal dan penyimpanan sesi bawaan tidak berbagi state; gunakan satu instance atau migrasikan ke database dan session store terkelola.

## Catatan aturan

Jumlah pada `buku.jumlah_buku` adalah stok tersedia. Batas 3 buku menghitung semua unit yang belum dikembalikan, termasuk pinjaman yang sedang berjalan. Pengembalian sebagian diperbolehkan dan memperbarui stok serta sisa pinjaman secara atomik.
