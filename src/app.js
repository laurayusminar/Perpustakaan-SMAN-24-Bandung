require('dotenv').config();
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const db = require('./db');
const { detectColumnMap, readImportFile, valueAt } = require('./import-data');

const app = express();
const adminRouter = express.Router();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const uploadImportFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx'].includes(extension)) return callback(new Error('Format file tidak didukung. Pilih file .csv atau .xlsx.'));
    callback(null, true);
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: isProduction ? '1d' : 0 }));
app.use(session({
  name: 'perpus.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 }
}));

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = csrfToken(req);
  res.locals.currentPath = req.path;
  res.locals.today = today();
  next();
});

app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  if (req.is('multipart/form-data') && /^\/admin\/data\/(anggota|buku)\/import$/.test(req.path)) return next();
  if (!isValidCsrf(req, req.body._csrf)) {
    return res.status(403).render('error', { title: 'Permintaan ditolak', message: 'Token keamanan tidak valid. Muat ulang halaman, lalu coba kembali.' });
  }
  next();
});

function isValidCsrf(req, receivedToken) {
  const expected = req.session.csrfToken || '';
  const received = String(receivedToken || '');
  return Boolean(expected && expected.length === received.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received)));
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/admin/login');
  next();
}

function redirectNotice(res, pathName, message, kind = 'success') {
  const adminPath = pathName.startsWith('/admin') ? pathName : `/admin${pathName}`;
  const separator = adminPath.includes('?') ? '&' : '?';
  res.redirect(`${adminPath}${separator}${kind}=${encodeURIComponent(message)}`);
}

app.get('/', (req, res) => res.redirect('/katalog'));

adminRouter.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin/dashboard');
  res.render('login', { title: 'Masuk', error: '' });
});

function getPublicCatalog(query) {
  const search = String(query.q || '').trim().slice(0, 100);
  const categoryId = String(query.kategori || '').trim();
  const conditions = [];
  const values = [];
  if (search) {
    conditions.push('(b.judul_buku LIKE ? OR b.pengarang LIKE ? OR b.isbn LIKE ?)');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (/^\d+$/.test(categoryId)) {
    conditions.push('b.kode_kategori = ?');
    values.push(Number(categoryId));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const books = db.prepare(`SELECT b.kode_buku, b.judul_buku, b.pengarang, b.penerbit,
      b.tahun_terbit, b.isbn, b.jumlah_buku, k.nama_kategori
    FROM buku b JOIN kategori k ON k.kode_kategori = b.kode_kategori
    ${where} ORDER BY b.judul_buku COLLATE NOCASE LIMIT 200`).all(...values);
  return { books, search, categoryId };
}

app.get('/katalog', (req, res) => {
  const { books, search, categoryId } = getPublicCatalog(req.query);
  const categories = db.prepare('SELECT kode_kategori, nama_kategori FROM kategori ORDER BY nama_kategori COLLATE NOCASE').all();
  res.render('public-catalog', {
    title: 'Katalog Buku', books, categories, search, categoryId,
    user: null, csrfToken: '', currentPath: req.path, today: today()
  });
});

app.get('/api/public/books', (req, res) => {
  const { books } = getPublicCatalog(req.query);
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json(books);
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Terlalu banyak percobaan masuk. Silakan coba kembali dalam 15 menit.'
});

adminRouter.post('/login', loginLimiter, (req, res, next) => {
  const identity = String(req.body.identity || '').trim();
  const password = String(req.body.password || '');
  const staff = db.prepare('SELECT * FROM petugas WHERE username = ? OR email = ?').get(identity, identity);
  if (!staff || !bcrypt.compareSync(password, staff.password)) {
    return res.status(401).render('login', { title: 'Masuk', error: 'Username/email atau kata sandi tidak sesuai.' });
  }
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = { id: staff.kode_petugas, name: staff.nama_petugas, username: staff.username };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.redirect('/admin/dashboard');
  });
});

adminRouter.use(requireAuth);

adminRouter.get('/', (req, res) => res.redirect('/admin/dashboard'));

adminRouter.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('perpus.sid', { httpOnly: true, sameSite: 'strict', secure: isProduction });
    res.redirect('/admin/login');
  });
});

adminRouter.get('/dashboard', (req, res) => {
  const day = today();
  const statistics = {
    books: db.prepare('SELECT COUNT(*) AS total FROM buku').get().total,
    categories: db.prepare('SELECT COUNT(*) AS total FROM kategori').get().total,
    members: db.prepare('SELECT COUNT(*) AS total FROM anggota').get().total,
    activeLoans: db.prepare(`SELECT COALESCE(SUM(p.jumlah_buku - COALESCE(r.returned, 0)), 0) AS total
      FROM peminjaman p LEFT JOIN (SELECT kode_peminjaman, SUM(jumlah_buku) AS returned FROM pengembalian GROUP BY kode_peminjaman) r
      ON r.kode_peminjaman = p.kode_peminjaman`).get().total,
    loansToday: db.prepare('SELECT COUNT(*) AS total FROM peminjaman WHERE tanggal_peminjaman = ?').get(day).total,
    returnsToday: db.prepare('SELECT COUNT(*) AS total FROM pengembalian WHERE tanggal_pengembalian = ?').get(day).total
  };
  const recentLoans = db.prepare(`SELECT p.kode_peminjaman, p.tanggal_peminjaman, p.tanggal_jatuh_tempo,
      a.nama AS nama_anggota, b.judul_buku,
      p.jumlah_buku - COALESCE(r.returned, 0) AS sisa_buku
    FROM peminjaman p JOIN anggota a ON a.kode_anggota = p.kode_anggota
    JOIN buku b ON b.kode_buku = p.kode_buku
    LEFT JOIN (SELECT kode_peminjaman, SUM(jumlah_buku) AS returned FROM pengembalian GROUP BY kode_peminjaman) r
      ON r.kode_peminjaman = p.kode_peminjaman
    ORDER BY p.kode_peminjaman DESC LIMIT 6`).all();
  res.render('dashboard', { title: 'Ringkasan', statistics, recentLoans });
});

const resources = {
  anggota: {
    title: 'Anggota', singular: 'anggota', table: 'anggota', key: 'kode_anggota',
    columns: [{ name: 'nis', label: 'NIS' }, { name: 'nama', label: 'Nama' }, { name: 'kelas', label: 'Kelas' }, { name: 'status', label: 'Status' }, { name: 'no_telp', label: 'No. telepon' }, { name: 'alamat', label: 'Alamat' }, { name: 'keterangan', label: 'Keterangan' }],
    fields: [
      { name: 'nis', label: 'NIS' },
      { name: 'nama', label: 'Nama lengkap', required: true },
      { name: 'kelas', label: 'Kelas', required: true, placeholder: 'Contoh: XI IPA 1' },
      { name: 'status', label: 'Status anggota', type: 'select', required: true, default: 'Aktif' },
      { name: 'no_telp', label: 'Nomor telepon', type: 'tel' },
      { name: 'alamat', label: 'Alamat', type: 'textarea' },
      { name: 'keterangan', label: 'Keterangan', type: 'textarea' }
    ], search: ['nis', 'nama', 'kelas', 'no_telp'],
    filters: [
      { name: 'kelas', label: 'Kelas', expression: 'kelas' },
      { name: 'status', label: 'Status', expression: 'status' }
    ]
  },
  buku: {
    title: 'Koleksi Buku', singular: 'buku', table: 'buku', key: 'kode_buku',
    columns: [{ name: 'kode_buku', label: 'Kode' }, { name: 'judul_buku', label: 'Judul' }, { name: 'pengarang', label: 'Pengarang' }, { name: 'nama_kategori', label: 'Kategori' }, { name: 'jumlah_buku', label: 'Stok tersedia' }],
    fields: [
      { name: 'kode_buku', label: 'Kode buku', required: true },
      { name: 'judul_buku', label: 'Judul buku', required: true },
      { name: 'pengarang', label: 'Pengarang' },
      { name: 'penerbit', label: 'Penerbit' },
      { name: 'tahun_terbit', label: 'Tahun terbit', type: 'number', min: 1000, max: 2100 },
      { name: 'isbn', label: 'ISBN' },
      { name: 'jumlah_buku', label: 'Stok tersedia', type: 'number', min: 0, required: true },
      { name: 'kode_kategori', label: 'Kategori', type: 'select', required: true }
    ], search: ['kode_buku', 'judul_buku', 'pengarang', 'isbn'], joins: 'JOIN kategori k ON k.kode_kategori = buku.kode_kategori', select: 'buku.*, k.nama_kategori',
    filters: [{ name: 'kode_kategori', label: 'Kategori', expression: 'buku.kode_kategori' }]
  },
  kategori: {
    title: 'Kategori', singular: 'kategori', table: 'kategori', key: 'kode_kategori',
    columns: [{ name: 'nama_kategori', label: 'Nama kategori' }],
    fields: [{ name: 'nama_kategori', label: 'Nama kategori', required: true }], search: ['nama_kategori']
  },
  petugas: {
    title: 'Petugas', singular: 'petugas', table: 'petugas', key: 'kode_petugas',
    columns: [{ name: 'nama_petugas', label: 'Nama' }, { name: 'username', label: 'Username' }, { name: 'email', label: 'Email' }],
    fields: [
      { name: 'nama_petugas', label: 'Nama lengkap', required: true },
      { name: 'username', label: 'Username', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'password', label: 'Kata sandi', type: 'password', required: true, hint: 'Minimal 8 karakter. Kosongkan saat edit jika tidak ingin mengganti.' }
    ], search: ['nama_petugas', 'username', 'email']
  }
};

function getOptions(type) {
  if (type === 'buku') {
    return { kode_kategori: db.prepare('SELECT kode_kategori AS value, nama_kategori AS label FROM kategori ORDER BY nama_kategori').all() };
  }
  if (type === 'anggota') {
    return { status: ['Aktif', 'Alumni', 'Keluar'].map((status) => ({ value: status, label: status })) };
  }
  return {};
}

function importUpload(req, res, next) {
  uploadImportFile.single('file')(req, res, (error) => {
    if (!isValidCsrf(req, req.body?._csrf)) {
      return res.status(403).render('error', { title: 'Permintaan ditolak', message: 'Token keamanan tidak valid. Muat ulang halaman, lalu coba kembali.' });
    }
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran file melebihi batas 5 MB.'
      : error.message || 'File tidak dapat diunggah.';
    return redirectNotice(res, `/data/${req.params.type}`, message, 'importError');
  });
}

adminRouter.get('/data/:type/template', (req, res) => {
  if (!['anggota', 'buku'].includes(req.params.type)) {
    return res.status(404).render('error', { title: 'Template tidak tersedia', message: 'Template hanya tersedia untuk data anggota dan buku.' });
  }
  const content = req.params.type === 'anggota'
    ? '\uFEFFNIS,Nama Lengkap,Kelas,No. Telepon,Alamat\r\n1234567890,Nama Siswa,XI IPA 1,08123456789,Jalan Contoh 1\r\n'
    : '\uFEFFKode Buku,Judul Buku,Pengarang,Penerbit,Tahun Terbit,Jumlah Buku,Kategori\r\nBK-100,Contoh Judul,Nama Pengarang,Nama Penerbit,2024,5,Umum\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="template-${req.params.type}.csv"`);
  res.send(content);
});

adminRouter.post('/data/:type/import', importUpload, async (req, res) => {
  const kind = req.params.type;
  if (!['anggota', 'buku'].includes(kind)) {
    return redirectNotice(res, '/data/anggota', 'Impor hanya tersedia untuk data anggota dan buku.', 'importError');
  }
  if (!req.file) return redirectNotice(res, `/data/${kind}`, 'Pilih file CSV atau Excel terlebih dahulu.', 'importError');

  try {
    const { headers, rows } = await readImportFile(req.file);
    const mapping = detectColumnMap(kind, headers);
    const required = kind === 'anggota' ? ['nis', 'nama'] : ['kode_buku', 'judul_buku'];
    const missing = required.filter((field) => mapping[field] === undefined);
    if (missing.length) {
      const labels = { nis: 'NIS / Nomor Induk', nama: 'Nama siswa', kode_buku: 'Kode Buku', judul_buku: 'Judul Buku' };
      return redirectNotice(res, `/data/${kind}`, `Header wajib tidak ditemukan: ${missing.map((field) => labels[field]).join(' dan ')}. Periksa baris header atau gunakan template.`, 'importError');
    }

    const strategy = String(req.body.duplicate_strategy || 'skip');
    if (!['skip', 'update'].includes(strategy)) {
      return redirectNotice(res, `/data/${kind}`, 'Pilihan penanganan duplikat tidak valid.', 'importError');
    }

    const result = kind === 'anggota'
      ? importMembers(rows, mapping, strategy)
      : importBooks(rows, mapping, strategy);
    let reviewId = '';
    if (result.invalid.length) {
      reviewId = crypto.randomUUID();
      req.session.importReview = {
        id: reviewId,
        kind,
        userId: req.session.user.id,
        strategy,
        createdAt: Date.now(),
        imported: result.imported,
        skipped: result.skipped,
        updated: result.updated,
        ignored: 0,
        items: result.invalid
      };
      await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    } else {
      delete req.session.importReview;
    }
    const query = new URLSearchParams({
      imported: String(result.imported),
      skipped: String(result.skipped),
      updated: String(result.updated),
      reviewCount: String(result.invalid.length),
      ...(reviewId ? { review: reviewId } : {})
    });
    return res.redirect(`/admin/data/${kind}?${query.toString()}`);
  } catch (error) {
    const message = error.code === 'CSV_RECORD_DONT_MATCH_COLUMNS_LENGTH'
      ? 'Struktur CSV tidak konsisten. Pastikan setiap baris memiliki format kolom yang sesuai.'
      : error.message || 'File gagal diproses. Pastikan file tidak rusak dan coba kembali.';
    return redirectNotice(res, `/data/${kind}`, message, 'importError');
  }
});

function getImportReview(req, kind, reviewId) {
  const review = req.session.importReview;
  if (!review || review.id !== reviewId || review.kind !== kind || review.userId !== req.session.user.id) return null;
  if (Date.now() - review.createdAt > 60 * 60 * 1000) {
    delete req.session.importReview;
    return null;
  }
  return review;
}

adminRouter.post('/data/:type/import-review/:reviewId/:itemId/save', (req, res) => {
  const kind = req.params.type;
  const review = getImportReview(req, kind, req.params.reviewId);
  if (!review) return redirectNotice(res, `/data/${kind}`, 'Antrean review tidak ditemukan atau sudah kedaluwarsa.', 'importError');
  const itemIndex = review.items.findIndex((item) => item.id === req.params.itemId);
  if (itemIndex < 0) return redirectNotice(res, `/data/${kind}?review=${review.id}`, 'Baris review tersebut sudah tidak tersedia.', 'importError');

  const item = review.items[itemIndex];
  const data = { ...item.data };
  for (const field of item.mappedFields) {
    if (Object.hasOwn(req.body, field)) data[field] = String(req.body[field] ?? '').trim();
  }
  const mapping = Object.fromEntries(item.mappedFields.map((field, index) => [field, index]));
  const row = { rowNumber: item.rowNumber, values: item.mappedFields.map((field) => data[field] ?? '') };
  const result = kind === 'anggota'
    ? importMembers([row], mapping, review.strategy)
    : importBooks([row], mapping, review.strategy);

  if (result.invalid.length) {
    review.items[itemIndex] = { ...result.invalid[0], id: item.id };
    review.items[itemIndex].data = data;
    return redirectNotice(res, `/data/${kind}?review=${review.id}`, 'Baris belum dapat disimpan. Periksa kembali alasan yang ditampilkan.', 'importError');
  }

  review.items.splice(itemIndex, 1);
  review.imported += result.imported;
  review.updated += result.updated;
  review.skipped = Math.max(0, review.skipped - 1);
  return res.redirect(`/admin/data/${kind}?review=${review.id}&reviewNotice=${encodeURIComponent('Baris berhasil diperbaiki dan disimpan.')}`);
});

adminRouter.post('/data/:type/import-review/:reviewId/:itemId/ignore', (req, res) => {
  const kind = req.params.type;
  const review = getImportReview(req, kind, req.params.reviewId);
  if (!review) return redirectNotice(res, `/data/${kind}`, 'Antrean review tidak ditemukan atau sudah kedaluwarsa.', 'importError');
  const itemIndex = review.items.findIndex((item) => item.id === req.params.itemId);
  if (itemIndex < 0) return redirectNotice(res, `/data/${kind}?review=${review.id}`, 'Baris review tersebut sudah tidak tersedia.', 'importError');
  review.items.splice(itemIndex, 1);
  review.ignored += 1;
  return res.redirect(`/admin/data/${kind}?review=${review.id}&reviewNotice=${encodeURIComponent('Baris diabaikan dan dihapus dari antrean review.')}`);
});

const IMPORT_FIELDS = {
  anggota: ['nis', 'nama', 'kelas', 'no_telp', 'alamat'],
  buku: ['kode_buku', 'judul_buku', 'pengarang', 'penerbit', 'tahun_terbit', 'jumlah_buku', 'isbn', 'kategori']
};

function rawImportData(kind, row, mapping) {
  const data = Object.fromEntries(IMPORT_FIELDS[kind].map((field) => [field, valueAt(row.values, mapping, field)]));
  const mappedFields = IMPORT_FIELDS[kind].filter((field) => mapping[field] !== undefined);
  return { data, mappedFields };
}

function addInvalid(result, rowNumber, data, mappedFields, reasons) {
  result.skipped += 1;
  result.invalid.push({
    id: crypto.randomUUID(),
    rowNumber,
    data,
    mappedFields,
    reasons
  });
}

function importMembers(rows, mapping, strategy) {
  const findByNis = db.prepare('SELECT kode_anggota, kelas, no_telp, alamat FROM anggota WHERE nis = ? COLLATE NOCASE LIMIT 1');
  const insertMember = db.prepare(`INSERT INTO anggota (nis, nama, kelas, no_telp, alamat, status)
    VALUES (?, ?, ?, ?, ?, 'Aktif')`);
  const updateMember = db.prepare('UPDATE anggota SET nama = ?, kelas = ?, no_telp = ?, alamat = ? WHERE kode_anggota = ?');
  const seen = new Set();
  const totals = { imported: 0, skipped: 0, updated: 0, invalid: [] };

  const runImport = db.transaction(() => {
    for (const row of rows) {
      const { data, mappedFields } = rawImportData('anggota', row, mapping);
      const { nis, nama } = data;
      const reasons = [];
      if (!nis) reasons.push('NIS kosong');
      else if (nis.length > 50) reasons.push('NIS melebihi 50 karakter');
      if (!nama) reasons.push('Nama siswa kosong');
      else if (nama.length > 160) reasons.push('Nama siswa melebihi 160 karakter');
      if (data.kelas.length > 40) reasons.push('Kelas melebihi 40 karakter');
      if (data.no_telp.length > 30) reasons.push('Nomor telepon melebihi 30 karakter');
      if (data.alamat.length > 500) reasons.push('Alamat melebihi 500 karakter');
      if (reasons.length) { addInvalid(totals, row.rowNumber, data, mappedFields, reasons); continue; }
      const key = nis.toLocaleLowerCase();
      if (seen.has(key)) { addInvalid(totals, row.rowNumber, data, mappedFields, ['NIS duplikat di dalam file']); continue; }
      seen.add(key);
      const existing = findByNis.get(nis);
      if (existing) {
        if (strategy === 'skip') { addInvalid(totals, row.rowNumber, data, mappedFields, ['NIS sudah terdaftar di database']); continue; }
        updateMember.run(
          nama,
          mappedFields.includes('kelas') ? data.kelas : existing.kelas,
          mappedFields.includes('no_telp') ? data.no_telp : existing.no_telp,
          mappedFields.includes('alamat') ? data.alamat : existing.alamat,
          existing.kode_anggota
        );
        totals.imported += 1;
        totals.updated += 1;
        continue;
      }
      insertMember.run(nis, nama, data.kelas, data.no_telp, data.alamat);
      totals.imported += 1;
    }
  });
  runImport();
  return totals;
}

function importBooks(rows, mapping, strategy) {
  const findByCode = db.prepare('SELECT kode_buku FROM buku WHERE kode_buku = ?');
  const getCategory = db.prepare('SELECT kode_kategori FROM kategori WHERE nama_kategori = ? COLLATE NOCASE');
  const insertCategory = db.prepare('INSERT INTO kategori (nama_kategori) VALUES (?)');
  const insertBook = db.prepare(`INSERT INTO buku
    (kode_buku, judul_buku, pengarang, penerbit, tahun_terbit, jumlah_buku, isbn, kode_kategori)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateBook = db.prepare(`UPDATE buku SET judul_buku = ?, pengarang = ?, penerbit = ?,
    tahun_terbit = ?, jumlah_buku = ?, isbn = ?, kode_kategori = ? WHERE kode_buku = ?`);
  const seen = new Set();
  const totals = { imported: 0, skipped: 0, updated: 0, invalid: [] };

  const runImport = db.transaction(() => {
    for (const row of rows) {
      const { data, mappedFields } = rawImportData('buku', row, mapping);
      const { kode_buku: kode, judul_buku: judul } = data;
      const reasons = [];
      if (!kode) reasons.push('Kode buku kosong');
      else if (kode.length > 80) reasons.push('Kode buku melebihi 80 karakter');
      if (!judul) reasons.push('Judul buku kosong');
      else if (judul.length > 240) reasons.push('Judul buku melebihi 240 karakter');
      const yearText = data.tahun_terbit;
      const quantityText = data.jumlah_buku;
      const year = yearText ? Number(yearText) : null;
      const quantity = quantityText ? Number(quantityText) : 0;
      if (yearText && (!Number.isInteger(year) || year < 1000 || year > 2100)) reasons.push('Tahun terbit harus berupa angka antara 1000 dan 2100');
      if (quantityText && (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000)) reasons.push('Jumlah stok harus angka bulat minimal 0');
      if (data.pengarang.length > 160) reasons.push('Pengarang melebihi 160 karakter');
      if (data.penerbit.length > 160) reasons.push('Penerbit melebihi 160 karakter');
      if (data.isbn.length > 40) reasons.push('ISBN melebihi 40 karakter');
      if (data.kategori.length > 100) reasons.push('Kategori melebihi 100 karakter');
      if (reasons.length) { addInvalid(totals, row.rowNumber, data, mappedFields, reasons); continue; }
      const key = kode.toLocaleLowerCase();
      if (seen.has(key)) { addInvalid(totals, row.rowNumber, data, mappedFields, ['Kode buku duplikat di dalam file']); continue; }
      seen.add(key);

      const existing = findByCode.get(kode);
      if (existing && strategy === 'skip') { addInvalid(totals, row.rowNumber, data, mappedFields, ['Kode buku sudah terdaftar di database']); continue; }
      const sourceCategory = data.kategori;
      if (existing) {
        const current = db.prepare('SELECT tahun_terbit, jumlah_buku, pengarang, penerbit, isbn, kode_kategori FROM buku WHERE kode_buku = ?').get(kode);
        const categoryName = sourceCategory;
        let categoryId = current.kode_kategori;
        if (categoryName) {
          let category = getCategory.get(categoryName);
          if (!category) {
            const inserted = insertCategory.run(categoryName.slice(0, 100));
            category = { kode_kategori: inserted.lastInsertRowid };
          }
          categoryId = category.kode_kategori;
        }
        updateBook.run(
          judul,
          mappedFields.includes('pengarang') ? data.pengarang : current.pengarang,
          mappedFields.includes('penerbit') ? data.penerbit : current.penerbit,
          yearText ? year : current.tahun_terbit,
          quantityText ? quantity : current.jumlah_buku,
          mappedFields.includes('isbn') ? data.isbn : current.isbn,
          categoryId,
          kode
        );
        totals.imported += 1;
        totals.updated += 1;
      } else {
        const categoryName = sourceCategory || 'Umum';
        let category = getCategory.get(categoryName);
        if (!category) {
          const inserted = insertCategory.run(categoryName.slice(0, 100));
          category = { kode_kategori: inserted.lastInsertRowid };
        }
        insertBook.run(
          kode, judul, data.pengarang, data.penerbit,
          year, quantity, data.isbn, category.kode_kategori
        );
        totals.imported += 1;
      }
    }
  });
  runImport();
  return totals;
}

adminRouter.get('/data/anggota/bulk-class', (req, res) => {
  const classes = db.prepare("SELECT DISTINCT kelas FROM anggota WHERE status = 'Aktif' ORDER BY kelas").all().map((row) => row.kelas);
  const sourceClass = String(req.query.kelas_asal || '');
  const members = sourceClass
    ? db.prepare("SELECT kode_anggota, nis, nama, kelas, status FROM anggota WHERE kelas = ? AND status = 'Aktif' ORDER BY nama").all(sourceClass)
    : [];
  res.render('member-bulk-class', {
    title: 'Perbarui Kelas', classes, sourceClass, members,
    notice: req.query.success || '', error: req.query.error || ''
  });
});

adminRouter.post('/data/anggota/bulk-class', (req, res) => {
  const sourceClass = String(req.body.kelas_asal || '').trim();
  const targetClass = String(req.body.kelas_tujuan || '').trim();
  if (!sourceClass || !targetClass) {
    return redirectNotice(res, '/data/anggota/bulk-class', 'Pilih kelas asal dan isi kelas tujuan.', 'error');
  }
  if (sourceClass === targetClass) {
    return redirectNotice(res, `/data/anggota/bulk-class?kelas_asal=${encodeURIComponent(sourceClass)}`, 'Kelas tujuan harus berbeda dari kelas asal.', 'error');
  }
  const updateClass = db.transaction(() => db.prepare("UPDATE anggota SET kelas = ? WHERE kelas = ? AND status = 'Aktif'").run(targetClass, sourceClass));
  const result = updateClass();
  if (!result.changes) {
    return redirectNotice(res, `/data/anggota/bulk-class?kelas_asal=${encodeURIComponent(sourceClass)}`, 'Tidak ada anggota pada kelas asal tersebut.', 'error');
  }
  return redirectNotice(res, '/data/anggota', `${result.changes} anggota berhasil dipindahkan dari ${sourceClass} ke ${targetClass}.`);
});

function getResource(req, res) {
  const config = resources[req.params.type];
  if (!config) {
    res.status(404).render('error', { title: 'Tidak ditemukan', message: 'Menu yang diminta tidak tersedia.' });
    return null;
  }
  return config;
}

adminRouter.get('/data/:type', (req, res) => {
  const config = getResource(req, res);
  if (!config) return;
  const search = String(req.query.q || '').trim();
  const rows = getResourceRows(config, req.query);
  const review = config.table === 'anggota' || config.table === 'buku'
    ? getImportReview(req, req.params.type, String(req.query.review || ''))
    : null;
  res.render('data-list', {
    title: config.title, config, rows, search,
    filters: getResourceFilterOptions(req.params.type),
    activeFilters: req.query,
    notice: req.query.success || '', error: req.query.error || '',
    importError: req.query.importError || '',
    importResult: req.query.imported === undefined ? null : {
      imported: Number(req.query.imported) || 0,
      skipped: Number(req.query.skipped) || 0,
      updated: Number(req.query.updated) || 0
    },
    importReview: review,
    reviewNotice: req.query.reviewNotice || ''
  });
});

adminRouter.get('/data/:type/export', async (req, res, next) => {
  const config = getResource(req, res);
  if (!config) return;
  try {
    const rows = getResourceRows(config, req.query);
    const columns = config.columns.map((column) => ({ header: column.label, key: column.name, width: Math.min(Math.max(column.label.length + 4, 16), 34) }));
    const workbook = createWorkbook(config.title, columns, rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${today()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/api/lookup/:type', (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 80);
  if (search.length < 1) return res.json([]);
  const pattern = `%${search}%`;
  if (req.params.type === 'anggota') {
    const results = db.prepare(`SELECT kode_anggota AS id, nis, nama, kelas
      FROM anggota WHERE status = 'Aktif' AND (nama LIKE ? OR nis LIKE ? OR kelas LIKE ?) ORDER BY nama LIMIT 12`).all(pattern, pattern, pattern);
    return res.json(results.map((member) => ({
      id: member.id,
      label: member.nama,
      detail: [member.nis || `ID ${member.id}`, member.kelas].filter(Boolean).join(' · ')
    })));
  }
  if (req.params.type === 'buku') {
    const results = db.prepare(`SELECT b.kode_buku AS id, b.judul_buku, b.pengarang, b.jumlah_buku, k.nama_kategori
      FROM buku b JOIN kategori k ON k.kode_kategori = b.kode_kategori
      WHERE b.jumlah_buku > 0 AND (b.judul_buku LIKE ? OR b.kode_buku LIKE ? OR b.pengarang LIKE ? OR b.isbn LIKE ?)
      ORDER BY b.judul_buku LIMIT 12`).all(pattern, pattern, pattern, pattern);
    return res.json(results.map((book) => ({
      id: book.id,
      label: book.judul_buku,
      detail: `${book.pengarang || 'Pengarang tidak dicantumkan'} · ${book.nama_kategori} · stok ${book.jumlah_buku}`
    })));
  }
  return res.status(404).json({ error: 'Jenis pencarian tidak tersedia.' });
});

function getResourceRows(config, query) {
  const conditions = [];
  const values = [];
  const search = String(query.q || '').trim();
  if (search) {
    conditions.push(`(${config.search.map((field) => `${field} LIKE ?`).join(' OR ')})`);
    values.push(...config.search.map(() => `%${search}%`));
  }
  for (const filter of config.filters || []) {
    const value = String(query[filter.name] || '').trim();
    if (!value) continue;
    if (filter.name === 'kode_kategori' && !/^\d+$/.test(value)) continue;
    conditions.push(`${filter.expression} = ?`);
    values.push(value);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT ${config.select || '*'} FROM ${config.table} ${config.joins || ''} ${where} ORDER BY ${config.key} DESC`).all(...values);
}

function getResourceFilterOptions(type) {
  if (type === 'anggota') {
    return {
      kelas: db.prepare('SELECT DISTINCT kelas AS value, kelas AS label FROM anggota WHERE kelas != ? ORDER BY kelas').all(''),
      status: ['Aktif', 'Alumni', 'Keluar'].map((status) => ({ value: status, label: status }))
    };
  }
  if (type === 'buku') {
    return { kode_kategori: db.prepare('SELECT kode_kategori AS value, nama_kategori AS label FROM kategori ORDER BY nama_kategori').all() };
  }
  return {};
}

function createWorkbook(sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Perpustakaan SMA Negeri 24 Bandung';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${columnLetter(columns.length)}1` };
  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF214F40' } };
    cell.alignment = { vertical: 'middle' };
  });
  return workbook;
}

function columnLetter(column) {
  let result = '';
  while (column > 0) {
    const remainder = (column - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    column = Math.floor((column - 1) / 26);
  }
  return result;
}

adminRouter.get('/data/:type/new', (req, res) => {
  const config = getResource(req, res);
  if (!config) return;
  res.render('data-form', { title: `Tambah ${config.singular}`, config, record: {}, options: getOptions(req.params.type), error: '' });
});

adminRouter.get('/data/:type/:id/edit', (req, res) => {
  const config = getResource(req, res);
  if (!config) return;
  const record = db.prepare(`SELECT * FROM ${config.table} WHERE ${config.key} = ?`).get(req.params.id);
  if (!record) return res.status(404).render('error', { title: 'Data tidak ditemukan', message: 'Data yang akan diedit tidak tersedia.' });
  res.render('data-form', { title: `Edit ${config.singular}`, config, record, options: getOptions(req.params.type), error: '' });
});

adminRouter.post('/data/:type/save', (req, res) => {
  const config = getResource(req, res);
  if (!config) return;
  const id = String(req.body.id || '').trim();
  const isEdit = Boolean(id);
  const values = {};
  let error = '';

  for (const field of config.fields) {
    let value = String(req.body[field.name] ?? '').trim();
    if (field.name === 'password' && isEdit && !value) continue;
    if (field.required && !value) {
      error = `${field.label} wajib diisi.`;
      break;
    }
    if (field.name === 'status' && !['Aktif', 'Alumni', 'Keluar'].includes(value)) {
      error = 'Status anggota harus Aktif, Alumni, atau Keluar.';
      break;
    }
    if (field.type === 'number' && value) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < (field.min ?? 0) || number > (field.max ?? Number.MAX_SAFE_INTEGER)) {
        error = `${field.label} harus berupa bilangan bulat yang valid.`;
        break;
      }
      value = number;
    }
    if (field.name === 'password' && value) {
      if (value.length < 8) {
        error = 'Kata sandi harus terdiri dari minimal 8 karakter.';
        break;
      }
      value = bcrypt.hashSync(value, 10);
    }
    values[field.name] = value;
  }

  const renderForm = (message) => {
    const record = { ...req.body };
    delete record.password;
    res.status(400).render('data-form', { title: `${isEdit ? 'Edit' : 'Tambah'} ${config.singular}`, config, record, options: getOptions(req.params.type), error: message });
  };
  if (error) return renderForm(error);

  try {
    const fields = Object.keys(values);
    if (isEdit) {
      if (fields.length) {
        const assignments = fields.map((field) => `${field} = ?`).join(', ');
        db.prepare(`UPDATE ${config.table} SET ${assignments} WHERE ${config.key} = ?`).run(...fields.map((field) => values[field]), id);
      }
    } else {
      const placeholders = fields.map(() => '?').join(', ');
      db.prepare(`INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${placeholders})`).run(...fields.map((field) => values[field]));
    }
    redirectNotice(res, `/data/${req.params.type}`, `Data ${config.singular} berhasil ${isEdit ? 'diperbarui' : 'ditambahkan'}.`);
  } catch (caught) {
    const message = caught.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ? 'Kode, username, email, atau nama kategori tersebut sudah digunakan.'
      : caught.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
        ? 'Kategori tidak tersedia atau data masih digunakan oleh transaksi.'
        : 'Data tidak dapat disimpan. Periksa kembali isian Anda.';
    renderForm(message);
  }
});

adminRouter.post('/data/:type/:id/delete', (req, res) => {
  const config = getResource(req, res);
  if (!config) return;
  if (req.params.type === 'petugas' && Number(req.params.id) === req.session.user.id) {
    return redirectNotice(res, `/data/${req.params.type}`, 'Akun yang sedang digunakan tidak dapat dihapus.', 'error');
  }
  try {
    db.prepare(`DELETE FROM ${config.table} WHERE ${config.key} = ?`).run(req.params.id);
    redirectNotice(res, `/data/${req.params.type}`, `Data ${config.singular} berhasil dihapus.`);
  } catch (caught) {
    const message = caught.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ? 'Data tidak dapat dihapus karena masih terhubung dengan transaksi atau koleksi.'
      : 'Data tidak dapat dihapus.';
    redirectNotice(res, `/data/${req.params.type}`, message, 'error');
  }
});

const loanQuery = `SELECT p.kode_peminjaman, p.kode_buku, p.kode_anggota, p.tanggal_peminjaman, p.tanggal_jatuh_tempo, p.jumlah_buku,
    a.nama AS nama_anggota, a.nis, a.kelas, b.judul_buku,
    COALESCE(r.returned, 0) AS jumlah_dikembalikan,
    p.jumlah_buku - COALESCE(r.returned, 0) AS sisa_buku
  FROM peminjaman p JOIN anggota a ON a.kode_anggota = p.kode_anggota
  JOIN buku b ON b.kode_buku = p.kode_buku
  LEFT JOIN (SELECT kode_peminjaman, SUM(jumlah_buku) AS returned FROM pengembalian GROUP BY kode_peminjaman) r
    ON r.kode_peminjaman = p.kode_peminjaman`;

function getFilteredLoans(query) {
  const conditions = [];
  const values = [];
  const startDate = String(query.mulai || '').trim();
  const endDate = String(query.selesai || '').trim();
  const status = String(query.status || '').trim();
  const search = String(query.q || '').trim();
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

  if (validDate(startDate)) { conditions.push('p.tanggal_peminjaman >= ?'); values.push(startDate); }
  if (validDate(endDate)) { conditions.push('p.tanggal_peminjaman <= ?'); values.push(endDate); }
  if (search) {
    conditions.push('(a.nama LIKE ? OR a.nis LIKE ? OR b.judul_buku LIKE ? OR b.kode_buku LIKE ?)');
    values.push(...Array(4).fill(`%${search}%`));
  }
  if (status === 'terlambat') conditions.push(`(p.jumlah_buku - COALESCE(r.returned, 0) > 0 AND p.tanggal_jatuh_tempo < '${today()}')`);
  if (status === 'dipinjam') conditions.push(`(p.jumlah_buku - COALESCE(r.returned, 0) > 0 AND p.tanggal_jatuh_tempo >= '${today()}')`);
  if (status === 'dikembalikan') conditions.push('(p.jumlah_buku - COALESCE(r.returned, 0) = 0)');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`${loanQuery} ${where} ORDER BY p.kode_peminjaman DESC`).all(...values);
}

function loanStatus(loan) {
  if (loan.sisa_buku === 0) return 'Dikembalikan';
  if (loan.tanggal_jatuh_tempo < today()) return 'Terlambat';
  return 'Dipinjam';
}

adminRouter.get('/transactions/export', async (req, res, next) => {
  try {
    const loans = getFilteredLoans(req.query);
    const rows = loans.map((loan) => ({
      kode_peminjaman: loan.kode_peminjaman,
      nama_anggota: loan.nama_anggota,
      nis: loan.nis,
      kelas: loan.kelas,
      judul_buku: loan.judul_buku,
      tanggal_peminjaman: loan.tanggal_peminjaman,
      tanggal_jatuh_tempo: loan.tanggal_jatuh_tempo,
      jumlah_buku: loan.jumlah_buku,
      jumlah_dikembalikan: loan.jumlah_dikembalikan,
      sisa_buku: loan.sisa_buku,
      status: loanStatus(loan)
    }));
    const columns = [
      { header: 'Kode transaksi', key: 'kode_peminjaman', width: 16 },
      { header: 'Nama anggota', key: 'nama_anggota', width: 26 },
      { header: 'NIS', key: 'nis', width: 16 },
      { header: 'Kelas', key: 'kelas', width: 16 },
      { header: 'Judul buku', key: 'judul_buku', width: 34 },
      { header: 'Tanggal pinjam', key: 'tanggal_peminjaman', width: 18 },
      { header: 'Jatuh tempo', key: 'tanggal_jatuh_tempo', width: 18 },
      { header: 'Jumlah pinjam', key: 'jumlah_buku', width: 16 },
      { header: 'Dikembalikan', key: 'jumlah_dikembalikan', width: 16 },
      { header: 'Sisa', key: 'sisa_buku', width: 12 },
      { header: 'Status', key: 'status', width: 18 }
    ];
    const workbook = createWorkbook('Riwayat Transaksi', columns, rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="transaksi-${today()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/transactions', (req, res) => {
  const loans = getFilteredLoans(req.query);
  const hasMembers = db.prepare('SELECT EXISTS(SELECT 1 FROM anggota) AS found').get().found;
  const hasBooks = db.prepare('SELECT EXISTS(SELECT 1 FROM buku WHERE jumlah_buku > 0) AS found').get().found;
  res.render('transactions', {
    title: 'Transaksi', loans, hasMembers, hasBooks,
    activeFilters: req.query,
    notice: req.query.success || '', error: req.query.error || '',
    currentDate: today(), dueDate: addDays(today(), 3)
  });
});

adminRouter.post('/transactions/borrow', (req, res) => {
  const memberId = Number(req.body.kode_anggota);
  const bookId = String(req.body.kode_buku || '').trim();
  const quantity = Number(req.body.jumlah_buku);
  const fail = (message) => redirectNotice(res, '/transactions', message, 'error');
  if (!Number.isInteger(memberId) || !bookId || !Number.isInteger(quantity) || quantity < 1) return fail('Pilih anggota, buku, dan jumlah pinjaman yang valid.');

  try {
    const borrow = db.transaction(() => {
      const member = db.prepare('SELECT kode_anggota, nama, status FROM anggota WHERE kode_anggota = ?').get(memberId);
      const book = db.prepare('SELECT kode_buku, jumlah_buku FROM buku WHERE kode_buku = ?').get(bookId);
      if (!member) throw new Error('Anggota tidak ditemukan.');
      if (member.status !== 'Aktif') throw new Error(`Peminjaman ditolak: status anggota ${member.nama} adalah ${member.status}.`);
      if (!book) throw new Error('Buku tidak ditemukan.');
      if (book.jumlah_buku < quantity) throw new Error('Stok buku tidak mencukupi.');
      const active = db.prepare(`SELECT COALESCE(SUM(p.jumlah_buku - COALESCE(r.returned, 0)), 0) AS total
        FROM peminjaman p LEFT JOIN (SELECT kode_peminjaman, SUM(jumlah_buku) AS returned FROM pengembalian GROUP BY kode_peminjaman) r
          ON r.kode_peminjaman = p.kode_peminjaman WHERE p.kode_anggota = ?`).get(memberId).total;
      if (active + quantity > 3) throw new Error(`Anggota masih memiliki ${active} buku. Batas aktif adalah 3 buku.`);
      const date = today();
      db.prepare('UPDATE buku SET jumlah_buku = jumlah_buku - ? WHERE kode_buku = ?').run(quantity, bookId);
      db.prepare(`INSERT INTO peminjaman (kode_petugas, kode_buku, kode_anggota, tanggal_peminjaman, tanggal_jatuh_tempo, jumlah_buku)
        VALUES (?, ?, ?, ?, ?, ?)`).run(req.session.user.id, bookId, memberId, date, addDays(date, 3), quantity);
    });
    borrow();
    return redirectNotice(res, '/transactions', 'Peminjaman berhasil dicatat. Batas pengembalian 3 hari.');
  } catch (caught) {
    return fail(caught.message || 'Peminjaman tidak dapat diproses.');
  }
});

adminRouter.post('/transactions/:id/return', (req, res) => {
  const loanId = Number(req.params.id);
  const quantity = Number(req.body.jumlah_buku);
  const fail = (message) => redirectNotice(res, '/transactions', message, 'error');
  if (!Number.isInteger(loanId) || !Number.isInteger(quantity) || quantity < 1) return fail('Jumlah pengembalian tidak valid.');

  try {
    const returnBooks = db.transaction(() => {
      const loan = db.prepare(`${loanQuery} WHERE p.kode_peminjaman = ?`).get(loanId);
      if (!loan) throw new Error('Transaksi peminjaman tidak ditemukan.');
      if (quantity > loan.sisa_buku) throw new Error(`Jumlah pengembalian melebihi sisa pinjaman (${loan.sisa_buku}).`);
      db.prepare(`INSERT INTO pengembalian
        (kode_petugas, kode_buku, kode_anggota, kode_peminjaman, tanggal_pengembalian, jumlah_buku)
        VALUES (?, ?, ?, ?, ?, ?)`).run(req.session.user.id, loan.kode_buku, loan.kode_anggota, loanId, today(), quantity);
      db.prepare('UPDATE buku SET jumlah_buku = jumlah_buku + ? WHERE kode_buku = (SELECT kode_buku FROM peminjaman WHERE kode_peminjaman = ?)').run(quantity, loanId);
    });
    returnBooks();
    return redirectNotice(res, '/transactions', 'Pengembalian berhasil dicatat dan stok diperbarui.');
  } catch (caught) {
    return fail(caught.message || 'Pengembalian tidak dapat diproses.');
  }
});

adminRouter.use((req, res) => res.status(404).render('error', { title: 'Halaman tidak ditemukan', message: 'Halaman admin yang Anda cari tidak tersedia.' }));
app.use('/admin', adminRouter);
app.use((req, res) => res.status(404).render('error', { title: 'Halaman tidak ditemukan', message: 'Halaman yang Anda cari tidak tersedia.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).render('error', { title: 'Terjadi kesalahan', message: 'Permintaan belum dapat diproses. Silakan coba kembali.' });
});

app.listen(port, () => console.log(`Perpustakaan berjalan di http://localhost:${port}`));
