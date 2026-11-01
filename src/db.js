const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Inisialisasi client Turso (libsql) atau fallback ke SQLite lokal jika offline
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, '..', 'database', 'perpustakaan.sqlite')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Fungsi untuk menjalankan migrasi schema dan seeding secara asinkronus
async function initDatabase() {
  const dataDirectory = path.join(__dirname, '..', 'database');
  
  // Baca schema.sql
  const schemaPath = path.join(dataDirectory, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    // Jalankan perintah schema per baris/blok ke Turso
    for (const statement of schemaSql.split(';')) {
      if (statement.trim()) {
        await db.execute(statement);
      }
    }
  }

  // Cek kolom tambahan pada tabel anggota
  try {
    const anggotaInfo = await db.execute("PRAGMA table_info(anggota)");
    const columns = anggotaInfo.rows.map(row => row.name);
    
    if (!columns.includes('nis')) {
      await db.execute("ALTER TABLE anggota ADD COLUMN nis TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.includes('status')) {
      await db.execute("ALTER TABLE anggota ADD COLUMN status TEXT NOT NULL DEFAULT 'Aktif'");
    }
  } catch (e) {
    console.log("Catatan migrasi kolom:", e.message);
  }

  // Seeding: Petugas
  const staffRes = await db.execute('SELECT COUNT(*) AS total FROM petugas');
  const staffCount = Number(staffRes.rows[0].total);
  if (staffCount === 0) {
    const password = process.env.ADMIN_PASSWORD || 'admin123!';
    const hashedPassword = bcrypt.hashSync(password, 10);
    await db.execute({
      sql: `INSERT INTO petugas (nama_petugas, username, password, email) VALUES (?, ?, ?, ?)`,
      args: [
        process.env.ADMIN_NAME || 'Administrator Perpustakaan',
        process.env.ADMIN_USERNAME || 'admin',
        hashedPassword,
        process.env.ADMIN_EMAIL || 'admin@perpus.local'
      ]
    });
  }

  // Seeding: Kategori
  const catRes = await db.execute('SELECT COUNT(*) AS total FROM kategori');
  if (Number(catRes.rows[0].total) === 0) {
    const categories = ['Fiksi', 'Ilmu Pengetahuan', 'Sejarah', 'Referensi'];
    for (const name of categories) {
      await db.execute({
        sql: 'INSERT INTO kategori (nama_kategori) VALUES (?)',
        args: [name]
      });
    }
  }

  // Seeding: Buku Dummy
  const bookRes = await db.execute('SELECT COUNT(*) AS total FROM buku');
  if (Number(bookRes.rows[0].total) === 0) {
    const catList = await db.execute('SELECT kode_kategori, nama_kategori FROM kategori');
    const categoryId = (name) => {
      const found = catList.rows.find((cat) => cat.nama_kategori === name);
      return found ? found.kode_kategori : 1;
    };

    const books = [
      ['BK-001', 'Laskar Pelangi', 'Andrea Hirata', 'Bentang Pustaka', 2005, '9789793062792', 8, categoryId('Fiksi')],
      ['BK-002', 'Bumi Manusia', 'Pramoedya Ananta Toer', 'Lentera Dipantara', 1980, '9789799731234', 5, categoryId('Fiksi')],
      ['BK-003', 'Sains untuk Semua', 'Tim Pustaka Sains', 'Pustaka Edukasi', 2022, '9786230000012', 6, categoryId('Ilmu Pengetahuan')]
    ];

    for (const b of books) {
      await db.execute({
        sql: `INSERT INTO buku (kode_buku, judul_buku, pengarang, penerbit, tahun_terbit, isbn, jumlah_buku, kode_kategori) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: b
      });
    }
  }
}

// Jalankan inisialisasi database
initDatabase().catch(err => console.error("Gagal menginisialisasi database:", err));

module.exports = db;