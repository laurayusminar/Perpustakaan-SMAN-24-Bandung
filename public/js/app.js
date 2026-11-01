document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});

document.querySelectorAll('.return-form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    const count = Number(form.querySelector('[name="jumlah_buku"]').value);
    if (!window.confirm(`Catat pengembalian ${count} buku ini?`)) event.preventDefault();
  });
});

document.querySelectorAll('.autocomplete-field').forEach((field) => {
  const type = field.dataset.autocomplete;
  const input = field.querySelector('.autocomplete-input');
  const selectedId = field.querySelector('input[type="hidden"]');
  const results = field.querySelector('.autocomplete-results');
  const feedback = field.querySelector('.autocomplete-feedback');
  let timer;
  let activeIndex = -1;

  const closeResults = () => {
    results.hidden = true;
    results.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  };

  const choose = (option) => {
    input.value = option.label;
    selectedId.value = option.id;
    feedback.textContent = option.detail;
    closeResults();
  };

  const showResults = (options) => {
    results.replaceChildren();
    activeIndex = -1;
    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'autocomplete-empty';
      empty.textContent = 'Tidak ada hasil yang cocok.';
      results.append(empty);
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'autocomplete-option';
      button.id = `${type}-option-${index}`;
      button.setAttribute('role', 'option');
      const label = document.createElement('strong');
      label.textContent = option.label;
      const detail = document.createElement('small');
      detail.textContent = option.detail;
      button.append(label, detail);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => choose(option));
      results.append(button);
    });
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    selectedId.value = '';
    feedback.textContent = '';
    clearTimeout(timer);
    const search = input.value.trim();
    if (!search) return closeResults();
    timer = setTimeout(async () => {
      try {
        const response = await fetch(`/admin/api/lookup/${type}?q=${encodeURIComponent(search)}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('lookup failed');
        showResults(await response.json());
      } catch {
        closeResults();
        feedback.textContent = 'Pencarian tidak tersedia. Coba kembali.';
      }
    }, 180);
  });

  input.addEventListener('keydown', (event) => {
    const options = [...results.querySelectorAll('.autocomplete-option')];
    if (event.key === 'ArrowDown' && !results.hidden && options.length) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % options.length;
    } else if (event.key === 'ArrowUp' && !results.hidden && options.length) {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + options.length) % options.length;
    } else if (event.key === 'Enter' && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      options[activeIndex].click();
    } else if (event.key === 'Escape') {
      closeResults();
    } else {
      return;
    }
    options.forEach((option, index) => option.classList.toggle('is-highlighted', index === activeIndex));
    if (activeIndex >= 0) input.setAttribute('aria-activedescendant', options[activeIndex].id);
  });

  input.addEventListener('blur', () => setTimeout(closeResults, 120));
});

document.querySelectorAll('.borrow-form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    const incomplete = [...form.querySelectorAll('.autocomplete-field')].find((field) => !field.querySelector('input[type="hidden"]').value);
    if (incomplete) {
      event.preventDefault();
      incomplete.querySelector('.autocomplete-feedback').textContent = 'Pilih salah satu hasil rekomendasi terlebih dahulu.';
      incomplete.querySelector('.autocomplete-input').focus();
    }
  });
});

document.querySelectorAll('[data-open-dialog]').forEach((button) => {
  button.addEventListener('click', () => {
    document.getElementById(button.dataset.openDialog)?.showModal();
  });
});

document.querySelectorAll('.import-dialog').forEach((dialog) => {
  dialog.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelector('input[type="file"]')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    const hint = event.target.closest('.field').querySelector('.field-hint');
    if (file) hint.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  });
  dialog.querySelector('form')?.addEventListener('submit', (event) => {
    const fileInput = dialog.querySelector('input[type="file"]');
    if (!fileInput.files.length) {
      event.preventDefault();
      fileInput.focus();
    }
  });
});

const pendingImportReview = document.querySelector('.import-review-dialog');
if (pendingImportReview && new URLSearchParams(window.location.search).has('review')) {
  pendingImportReview.showModal();
}
