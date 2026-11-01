const catalogForm = document.querySelector('.catalog-search-form');
const searchInput = document.querySelector('#catalog-search');
const categorySelect = document.querySelector('#catalog-category');
const clearButton = document.querySelector('.catalog-clear');
const catalogGrid = document.querySelector('#catalog-grid');
const emptyState = document.querySelector('#catalog-empty');
const resultCount = document.querySelector('#catalog-result-count');
const totalCount = document.querySelector('#catalog-total-count');
const liveStatus = document.querySelector('.catalog-live-status');
const limitNote = document.querySelector('#catalog-limit-note');
let searchTimer;
let activeRequest;

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createBookCard(book, index) {
  const article = makeElement('article', 'catalog-book');
  article.dataset.bookCard = '';
  const cover = makeElement('div', `book-cover book-cover-${index % 5}`);
  cover.setAttribute('role', 'img');
  cover.setAttribute('aria-label', `Ilustrasi sampul untuk ${book.judul_buku}`);
  const center = makeElement('div', 'cover-center');
  center.append(
    makeElement('span', 'cover-initials', (book.judul_buku || '?').trim().slice(0, 1).toUpperCase()),
    makeElement('span', 'cover-rule')
  );
  cover.append(
    makeElement('span', 'cover-school', 'SMAN 24 BANDUNG'),
    center,
    makeElement('span', 'cover-label', 'KOLEKSI PERPUSTAKAAN')
  );

  const info = makeElement('div', 'catalog-book-info');
  const top = makeElement('div', 'book-card-top');
  top.append(makeElement('span', 'book-category', book.nama_kategori));
  top.append(makeElement('span', 'book-year', book.tahun_terbit || 'Tahun tidak dicatat'));
  info.append(top, makeElement('h2', '', book.judul_buku));
  info.append(makeElement('p', 'book-author', book.pengarang || 'Pengarang tidak dicantumkan'));

  const details = makeElement('dl', 'book-details');
  for (const [label, value] of [['Penerbit', book.penerbit || '-'], ['ISBN', book.isbn || '-']]) {
    const row = makeElement('div');
    row.append(makeElement('dt', '', label), makeElement('dd', '', value));
    details.append(row);
  }
  info.append(details);

  const available = Number(book.jumlah_buku) > 0;
  const availability = makeElement('div', `book-availability ${available ? 'is-available' : 'is-unavailable'}`);
  availability.append(makeElement('span', 'availability-dot'));
  availability.append(makeElement('strong', '', available ? `Tersedia: ${book.jumlah_buku} eksemplar` : 'Tidak tersedia'));
  info.append(availability);
  article.append(cover, info);
  return article;
}

async function updateCatalog() {
  if (activeRequest) activeRequest.abort();
  activeRequest = new AbortController();
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  if (categorySelect.value) params.set('kategori', categorySelect.value);
  clearButton.hidden = !searchInput.value;
  liveStatus.textContent = 'Memuat koleksi...';

  try {
    const response = await fetch(`/api/public/books?${params}`, {
      headers: { Accept: 'application/json' },
      signal: activeRequest.signal
    });
    if (!response.ok) throw new Error('catalog request failed');
    const books = await response.json();
    catalogGrid.replaceChildren(...books.map(createBookCard));
    resultCount.textContent = `${books.length} judul`;
    totalCount.textContent = String(books.length);
    emptyState.hidden = books.length > 0;
    limitNote.hidden = books.length < 200;
    liveStatus.textContent = 'Hasil diperbarui';

    const currentUrl = new URL(window.location.href);
    if (searchInput.value.trim()) currentUrl.searchParams.set('q', searchInput.value.trim());
    else currentUrl.searchParams.delete('q');
    if (categorySelect.value) currentUrl.searchParams.set('kategori', categorySelect.value);
    else currentUrl.searchParams.delete('kategori');
    window.history.replaceState({}, '', currentUrl);
  } catch (error) {
    if (error.name !== 'AbortError') liveStatus.textContent = 'Pencarian gagal dimuat. Coba kembali.';
  }
}

catalogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  updateCatalog();
});

searchInput.addEventListener('input', () => {
  clearButton.hidden = !searchInput.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(updateCatalog, 220);
});

categorySelect.addEventListener('change', updateCatalog);
clearButton.addEventListener('click', () => {
  searchInput.value = '';
  clearButton.hidden = true;
  updateCatalog();
  searchInput.focus();
});
