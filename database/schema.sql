CREATE TABLE IF NOT EXISTS petugas (
  kode_petugas INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_petugas TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS anggota (
  kode_anggota INTEGER PRIMARY KEY AUTOINCREMENT,
  nis TEXT NOT NULL DEFAULT '',
  nama TEXT NOT NULL,
  kelas TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Alumni', 'Keluar')),
  no_telp TEXT NOT NULL DEFAULT '',
  alamat TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kategori (
  kode_kategori INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_kategori TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS buku (
  kode_buku TEXT PRIMARY KEY,
  judul_buku TEXT NOT NULL,
  pengarang TEXT NOT NULL DEFAULT '',
  penerbit TEXT NOT NULL DEFAULT '',
  tahun_terbit INTEGER,
  isbn TEXT NOT NULL DEFAULT '',
  jumlah_buku INTEGER NOT NULL DEFAULT 0 CHECK (jumlah_buku >= 0),
  kode_kategori INTEGER NOT NULL,
  FOREIGN KEY (kode_kategori) REFERENCES kategori (kode_kategori) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS peminjaman (
  kode_peminjaman INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_petugas INTEGER NOT NULL,
  kode_buku TEXT NOT NULL,
  kode_anggota INTEGER NOT NULL,
  tanggal_peminjaman TEXT NOT NULL,
  tanggal_jatuh_tempo TEXT NOT NULL,
  jumlah_buku INTEGER NOT NULL CHECK (jumlah_buku > 0),
  FOREIGN KEY (kode_petugas) REFERENCES petugas (kode_petugas) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (kode_buku) REFERENCES buku (kode_buku) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (kode_anggota) REFERENCES anggota (kode_anggota) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pengembalian (
  kode_pengembalian INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_petugas INTEGER NOT NULL,
  kode_buku TEXT NOT NULL,
  kode_anggota INTEGER NOT NULL,
  kode_peminjaman INTEGER NOT NULL,
  tanggal_pengembalian TEXT NOT NULL,
  jumlah_buku INTEGER NOT NULL CHECK (jumlah_buku > 0),
  FOREIGN KEY (kode_petugas) REFERENCES petugas (kode_petugas) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (kode_buku) REFERENCES buku (kode_buku) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (kode_anggota) REFERENCES anggota (kode_anggota) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (kode_peminjaman) REFERENCES peminjaman (kode_peminjaman) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_peminjaman_anggota ON peminjaman (kode_anggota);
CREATE INDEX IF NOT EXISTS idx_peminjaman_tanggal ON peminjaman (tanggal_peminjaman);
CREATE INDEX IF NOT EXISTS idx_pengembalian_pinjam ON pengembalian (kode_peminjaman);
