const { parse: parseCsv } = require('csv-parse/sync');
const ExcelJS = require('exceljs');

const HEADER_ALIASES = {
  anggota: {
    nis: ['nis', 'nisn', 'nomor induk', 'nomor induk siswa', 'no induk', 'kode anggota', 'id anggota'],
    nama: ['nama', 'nama lengkap', 'nama siswa', 'nama lengkap siswa', 'nama anggota', 'student name'],
    kelas: ['kelas', 'rombel', 'ruang kelas', 'class'],
    no_telp: ['no telp', 'no telepon', 'nomor telepon', 'telepon', 'no hp', 'nomor hp', 'handphone', 'hp'],
    alamat: ['alamat', 'alamat rumah', 'address']
  },
  buku: {
    kode_buku: ['kode buku', 'kode', 'id buku', 'isbn kode', 'book code', 'book id'],
    judul_buku: ['judul', 'judul buku', 'nama buku', 'title', 'book title'],
    pengarang: ['pengarang', 'penulis', 'nama pengarang', 'nama penulis', 'author'],
    penerbit: ['penerbit', 'nama penerbit', 'publisher'],
    isbn: ['isbn', 'isbn buku', 'nomor isbn'],
    tahun_terbit: ['tahun', 'tahun terbit', 'tahun publikasi', 'tahun terbitan', 'publication year'],
    jumlah_buku: ['jumlah', 'jumlah buku', 'stok', 'stok buku', 'jumlah stok', 'kuantitas', 'qty', 'quantity'],
    kategori: ['kategori', 'nama kategori', 'category']
  }
};

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detectColumnMap(kind, headers) {
  const aliases = HEADER_ALIASES[kind];
  if (!aliases) throw new Error('Jenis impor tidak didukung.');
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, names] of Object.entries(aliases)) {
    const normalizedAliases = names.map(normalizeHeader);
    let index = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
    if (index < 0) {
      index = normalizedHeaders.findIndex((header) => normalizedAliases.some((alias) => header.length >= alias.length + 2 && header.startsWith(alias)));
    }
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

async function readImportFile(file) {
  const extension = file.originalname.toLowerCase().split('.').pop();
  let rows;
  if (extension === 'csv') {
    rows = parseCsv(file.buffer, {
      bom: true,
      skip_empty_lines: false,
      relax_column_count: true,
      trim: true,
      delimiter: [',', ';', '\t']
    });
  } else if (extension === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Workbook tidak memiliki sheet yang bisa dibaca.');
    rows = [];
    sheet.eachRow({ includeEmpty: true }, (row) => rows.push({ rowNumber: row.number, values: row.values.slice(1) }));
  } else {
    throw new Error('Format file tidak didukung. Gunakan CSV atau Excel .xlsx.');
  }

  const rowsWithNumbers = rows.map((row, index) => Array.isArray(row)
    ? { rowNumber: index + 1, values: row }
    : row);
  const headerIndex = rowsWithNumbers.findIndex(({ values }) => values.some((value) => String(value ?? '').trim() !== ''));
  if (headerIndex < 0) throw new Error('File kosong. Pastikan terdapat satu baris header dan data.');
  const headers = rowsWithNumbers[headerIndex].values.map((cell) => String(cell ?? '').trim());
  const dataRows = rowsWithNumbers.slice(headerIndex + 1).filter(({ values }) => values.some((value) => String(value ?? '').trim() !== ''));
  if (!dataRows.length) throw new Error('File harus memiliki satu baris header dan minimal satu baris data.');
  if (dataRows.length > 5000) throw new Error('Maksimal 5.000 baris data per impor.');
  return { headers, rows: dataRows };
}

function valueAt(row, mapping, field) {
  const index = mapping[field];
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

module.exports = { detectColumnMap, normalizeHeader, readImportFile, valueAt };
