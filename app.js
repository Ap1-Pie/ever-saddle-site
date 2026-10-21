'use strict';

/* Ever saddle - итерация 5: реальные данные канала.
   Прочерк (поля нет в JSON) - строка скрыта в карточке и не матчится фильтрами.
   В Телеграме - нативные MainButton/BackButton и CloudStorage,
   в обычном браузере - свои элементы управления и localStorage. */

const TG = (window.Telegram && window.Telegram.WebApp) || null;
const DM_URL = 'https://t.me/zabudte_menya';
const isTelegram = !!(TG && TG.platform && TG.platform !== 'unknown');

const fmtPrice = new Intl.NumberFormat('ru-RU');
let saddles = [];

const HEART_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

function plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'седло';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'седла';
  return 'сёдел';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------- Избранное ---------- */

let favorites = new Set();
let favoritesMode = false;

const storage = {
  load() {
    if (isTelegram) {
      return new Promise(resolve => {
        TG.CloudStorage.getItem('favorites', (err, value) => {
          resolve(err || !value ? [] : value.split(',').filter(Boolean));
        });
      });
    }
    const v = localStorage.getItem('favorites');
    return Promise.resolve(v ? v.split(',').filter(Boolean) : []);
  },
  save() {
    const data = [...favorites].join(',');
    if (isTelegram) TG.CloudStorage.setItem('favorites', data, () => {});
    else localStorage.setItem('favorites', data);
  }
};

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  if (favoritesMode && favorites.size === 0) favoritesMode = false; // пустое избранное закрывает режим
  storage.save();
  haptic();
  renderHeaderFav();
  renderCatalog();
  const saddleHeart = document.getElementById('saddleFavBtn');
  if (saddleHeart) syncSaddleHeart(saddleHeart, saddleHeart.dataset.id);
}

function haptic() {
  if (isTelegram && TG.HapticFeedback) TG.HapticFeedback.selectionChanged();
}

function renderHeaderFav() {
  const btn = document.getElementById('favToggle');
  btn.setAttribute('aria-pressed', favoritesMode ? 'true' : 'false');
  btn.classList.toggle('is-on', favoritesMode);
  const badge = document.getElementById('favBadge');
  badge.textContent = favorites.size;
  badge.hidden = favorites.size === 0;
}

function syncSaddleHeart(btn, id) {
  const on = favorites.has(id);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/* ---------- Фильтры ---------- */

const filters = {
  type: new Set(),
  sizeRider: new Set(),
  material: new Set(),
  color: new Set(),
  priceFrom: null,
  priceTo: null,
  inStock: false
};

const GROUPS = [
  { key: 'type', label: 'Тип', field: 'type' },
  { key: 'sizeRider', label: 'Размер всаднику', field: 'sizeRider' },
  { key: 'material', label: 'Материал', field: 'material' },
  { key: 'color', label: 'Цвет', field: 'color' }
];

function chipValues(s, field) {
  if (field === 'sizeRider') {
    return (s.sizeRiderValues || (s.sizeRider !== undefined ? [s.sizeRider] : [])).map(String);
  }
  const v = s[field];
  return (v === undefined || v === null || v === '') ? [] : [String(v)];
}

function displayKey(v, field) {
  return field === 'sizeRider' ? v.replace('.', ',') : v;
}

function matchesExcept(s, skipKey) {
  for (const g of GROUPS) {
    if (g.key === skipKey) continue;
    if (filters[g.key].size) {
      const vals = chipValues(s, g.field); // пусто = поле-прочерк, не матчится ни с чем
      if (!vals.some(v => filters[g.key].has(v))) return false;
    }
  }
  if (filters.inStock && s.status === 'sold') return false; // прочерк статуса = не продано = в наличии
  if (filters.priceFrom !== null || filters.priceTo !== null) {
    if (s.price === undefined) return false;
    if (filters.priceFrom !== null && s.price < filters.priceFrom) return false;
    if (filters.priceTo !== null && s.price > filters.priceTo) return false;
  }
  return true;
}

function visibleSaddles() {
  return saddles.filter(s => matchesExcept(s, null));
}

function countFor(groupKey, value) {
  const g = GROUPS.find(x => x.key === groupKey);
  return saddles.filter(s => matchesExcept(s, groupKey) && chipValues(s, g.field).includes(value)).length;
}

function activeFilterCount() {
  let n = GROUPS.reduce((sum, g) => sum + filters[g.key].size, 0);
  if (filters.priceFrom !== null || filters.priceTo !== null) n++;
  if (filters.inStock) n++;
  return n;
}

/* ---------- Шторка фильтров ---------- */

function groupOptions(field) {
  const counts = new Map();
  saddles.forEach(s => {
    chipValues(s, field).forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  });
  let keys = [...counts.keys()];
  if (field === 'sizeRider') keys.sort((a, b) => Number(a) - Number(b));
  else keys.sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'ru'));
  return keys;
}

function buildSheet() {
  const root = document.getElementById('filterGroups');
  let html = '';
  for (const g of GROUPS) {
    const opts = groupOptions(g.field);
    if (opts.length === 0) continue; // группа без единого значения (все прочерки) не показывается
    html += '<div class="group-label">' + esc(g.label) + '</div><div class="chips">';
    for (const v of opts) {
      html += '<button type="button" class="chip" data-group="' + g.key + '" data-value="' + esc(v) + '">' +
        esc(displayKey(v, g.field)) + ' <small></small></button>';
    }
    html += '</div>';
  }
  html +=
    '<div class="group-label">Цена, руб</div>' +
    '<div class="price-row">' +
      '<input type="number" inputmode="numeric" min="0" placeholder="от" id="priceFrom" aria-label="Цена от">' +
      '<span>-</span>' +
      '<input type="number" inputmode="numeric" min="0" placeholder="до" id="priceTo" aria-label="Цена до">' +
    '</div>' +
    '<div class="switch-row">' +
      '<span class="switch-label">Только в наличии</span>' +
      '<label class="switch">' +
        '<input type="checkbox" id="inStock">' +
        '<span class="knob"></span>' +
      '</label>' +
    '</div>';
  root.innerHTML = html;

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const set = filters[chip.dataset.group];
    const v = chip.dataset.value;
    if (set.has(v)) set.delete(v); else set.add(v);
    refreshAfterFilterChange();
  });
  // Общий обработчик полей цены: обрезаем ввод длиннее 7 цифр (maxlength на type=number не работает)
  const onPriceInput = (e) => {
    if (e.target.value.length > 7) e.target.value = e.target.value.slice(0, 7);
    filters[e.target.id === 'priceFrom' ? 'priceFrom' : 'priceTo'] =
      e.target.value === '' ? null : Number(e.target.value);
    refreshAfterFilterChange();
  };
  document.getElementById('priceFrom').addEventListener('input', onPriceInput);
  document.getElementById('priceTo').addEventListener('input', onPriceInput);
  document.getElementById('inStock').addEventListener('change', (e) => {
    filters.inStock = e.target.checked;
    refreshAfterFilterChange();
  });
  document.getElementById('applyBtn').addEventListener('click', closeSheet);
  document.getElementById('resetBtn').addEventListener('click', () => {
    GROUPS.forEach(g => filters[g.key].clear());
    filters.priceFrom = filters.priceTo = null;
    filters.inStock = false;
    document.getElementById('priceFrom').value = '';
    document.getElementById('priceTo').value = '';
    document.getElementById('inStock').checked = false;
    refreshAfterFilterChange();
  });
  document.getElementById('filterBtn').addEventListener('click', openSheet);
  document.getElementById('sheetOverlay').addEventListener('click', closeSheet);
}

function updateSheet() {
  document.querySelectorAll('#filterGroups .chip').forEach(chip => {
    const on = filters[chip.dataset.group].has(chip.dataset.value);
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    chip.querySelector('small').textContent = countFor(chip.dataset.group, chip.dataset.value);
  });
}

function openSheet() {
  updateSheet();
  refreshApplyBtn();
  document.getElementById('sheetOverlay').classList.add('open');
  document.getElementById('filterSheet').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheetOverlay').classList.remove('open');
  document.getElementById('filterSheet').classList.remove('open');
}

function refreshApplyBtn() {
  const n = favoritesMode ? favoritesList().length : visibleSaddles().length;
  document.getElementById('applyBtn').textContent = 'Показать ' + n + ' ' + plural(n);
}

function refreshAfterFilterChange() {
  updateSheet();
  refreshApplyBtn();
  renderCatalog();
}

/* ---------- Каталог ---------- */

const EMPTY_SEARCH_SVG = '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const EMPTY_FAV_SVG = '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

function favoritesList() {
  return saddles.filter(s => favorites.has(s.id) && matchesExcept(s, null));
}

function priceHtml(s, cls) {
  if (s.price !== undefined) return '<div class="' + cls + '">' + fmtPrice.format(s.price) + ' руб</div>';
  return s.status === 'sold' ? '' : '<div class="' + cls + '">Цена по запросу</div>';
}

function cardHtml(s) {
  const sold = s.status === 'sold';
  const fav = favorites.has(s.id);
  return (
    '<article class="card' + (sold ? ' sold' : '') + '" data-id="' + esc(s.id) + '">' +
      '<div class="photo"><img src="' + esc(s.photos[0]) + '" alt="' + esc(s.title) + '" loading="lazy"></div>' +
      (sold ? '<span class="sold-tag">Продано</span>' : '') +
      '<button type="button" class="fav-btn" data-fav="' + esc(s.id) + '" aria-label="' +
        (fav ? 'Убрать из избранного' : 'Добавить в избранное') + '" aria-pressed="' + (fav ? 'true' : 'false') + '">' +
        HEART_SVG + '</button>' +
      '<h2 class="name">' + esc(s.title) + '</h2>' +
      priceHtml(s, 'price') +
    '</article>'
  );
}

function renderCatalog() {
  releaseTelegramButtons();
  stopGalleryTracking();
  const grid = document.getElementById('grid');
  grid.classList.remove('saddle-open');
  document.querySelector('.toolbar').style.display = '';
  let list, empty = null;
  if (favoritesMode) {
    list = favoritesList();
    if (list.length === 0) empty = EMPTY_FAV_SVG + '<h3>Пока пусто</h3><p>Нажмите на сердце у седла в каталоге - оно появится здесь</p>';
  } else {
    list = visibleSaddles();
    if (list.length === 0) empty = EMPTY_SEARCH_SVG + '<h3>Ничего не нашлось</h3><p>Попробуйте сбросить фильтры или выбрать другие значения</p>';
  }
  grid.innerHTML = empty
    ? '<div class="empty">' + empty + '</div>'
    : list.map(cardHtml).join('');
  document.getElementById('count').textContent = list.length + ' ' + plural(list.length);

  const n = activeFilterCount();
  const badge = document.getElementById('filterBadge');
  badge.textContent = n;
  badge.hidden = n === 0;
}

/* ---------- Карточка седла ---------- */

function fieldRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return '<div class="s-row"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
}

function saddleHtml(s) {
  const sold = s.status === 'sold';
  const brandModel = [s.brand, s.model].filter(Boolean).join(', ');
  const slides = s.photos.map(p =>
    '<div class="g-slide"><img src="' + esc(p) + '" alt="' + esc(s.title) + '"></div>'
  ).join('');
  const dots = s.photos.map((_, i) =>
    '<span class="dot' + (i === 0 ? ' on' : '') + '"></span>'
  ).join('');
  return (
    '<div class="saddle-view' + (sold ? ' sold' : '') + '">' +
      '<div class="s-head">' +
        (isTelegram ? '<span></span>' :
          '<button type="button" class="back-btn" id="backBtn">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>' +
            'Каталог' +
          '</button>') +
        '<button type="button" class="fav-btn fav-btn-page" id="saddleFavBtn" data-id="' + esc(s.id) + '" aria-label="В избранное" aria-pressed="' + (favorites.has(s.id) ? 'true' : 'false') + '">' +
          HEART_SVG + '<span class="fav-btn-text">' + (favorites.has(s.id) ? 'В избранном' : 'В избранное') + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="gallery">' +
        '<div class="g-track" id="gTrack">' + slides + '</div>' +
        (sold ? '<span class="sold-tag sold-tag-big">Продано</span>' : '') +
      '</div>' +
      '<div class="dots" id="gDots">' + dots + '</div>' +
      '<h1 class="s-title">' + esc(s.title) + '</h1>' +
      priceHtml(s, 's-price') +
      '<dl class="s-rows">' +
        fieldRow('Тип', s.type) +
        fieldRow('Бренд и модель', brandModel) +
        fieldRow('Размер всаднику', typeof s.sizeRider === 'number' ? String(s.sizeRider).replace('.', ',') : s.sizeRider) +
        fieldRow('Размер лошади', s.sizeHorse) +
        fieldRow('Материал', s.material) +
        fieldRow('Цвет', s.color) +
        fieldRow('Состояние', s.condition) +
        fieldRow('Особенности', s.comment) +
      '</dl>' +
      '<a class="dm-btn" href="' + DM_URL + '" ' +
        (isTelegram ? ' onclick="return false;"' : 'target="_blank" rel="noopener"') + '>Написать в ЛС</a>' +
    '</div>'
  );
}

let galleryTimer = null;
let galleryObserver = null;

function stopGalleryTracking() {
  if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }
}

function wireGallery() {
  stopGalleryTracking();
  const track = document.getElementById('gTrack');
  const dots = [...document.querySelectorAll('#gDots .dot')];
  if (!track || dots.length < 2) return;
  let current = 0;
  const update = (idx) => {
    if (idx === current || idx < 0 || idx >= dots.length) return;
    current = idx;
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));
  };

  track.addEventListener('scroll', () => {
    update(Math.round(track.scrollLeft / track.clientWidth));
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    const slides = [...track.querySelectorAll('.g-slide')];
    galleryObserver = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) update(slides.indexOf(en.target));
      });
    }, { root: track, threshold: 0.6 });
    slides.forEach(s => galleryObserver.observe(s));
  }

  // Запасной путь для WebView без доставки scroll-событий (iOS Telegram и т.п.)
  galleryTimer = setInterval(() => {
    update(Math.round(track.scrollLeft / track.clientWidth));
  }, 150);
}

function setupTelegramButtons() {
  if (!isTelegram) return;
  TG.BackButton.onClick(backToCatalog);
  TG.BackButton.show();
  TG.MainButton.setText('Написать в ЛС');
  TG.MainButton.offClick(openDm);
  TG.MainButton.onClick(openDm);
  TG.MainButton.show();
}

function releaseTelegramButtons() {
  if (!isTelegram) return;
  TG.MainButton.offClick(openDm);
  TG.MainButton.hide();
  TG.BackButton.offClick(backToCatalog);
  TG.BackButton.hide();
}

function openDm() {
  if (isTelegram) TG.openTelegramLink(DM_URL);
}

/* ---------- Переходы ---------- */

function openSaddle(id) {
  const s = saddles.find(x => x.id === id);
  if (!s) return;
  closeSheet();
  document.querySelector('.toolbar').style.display = 'none';
  const grid = document.getElementById('grid');
  grid.classList.add('saddle-open');
  grid.innerHTML = saddleHtml(s);
  const back = document.getElementById('backBtn');
  if (back) back.addEventListener('click', backToCatalog);
  document.getElementById('saddleFavBtn').addEventListener('click', (e) => {
    toggleFavorite(e.currentTarget.dataset.id);
  });
  wireGallery();
  setupTelegramButtons();
  window.scrollTo(0, 0);
  history.pushState({ view: 'saddle', id }, '', '#' + id);
}

function backToCatalog() {
  renderCatalog();
  history.pushState({ view: 'catalog' }, '', location.pathname);
}

window.addEventListener('popstate', () => {
  const saddleOpen = !!document.querySelector('.saddle-view');
  if (saddleOpen) renderCatalog();
});

/* ---------- Старт ---------- */

async function init() {
  if (TG) TG.ready();
  const grid = document.getElementById('grid');
  try {
    favorites = new Set(await storage.load());
    const res = await fetch('data/saddles.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    saddles = await res.json();
    saddles.sort((a, b) => b.post - a.post); // новые сверху
    const validIds = new Set(saddles.map(s => s.id));
    const stale = favorites.size;
    favorites = new Set([...favorites].filter(id => validIds.has(id))); // лайки исчезнувших сёдел
    if (favorites.size !== stale) storage.save();

    grid.addEventListener('click', (e) => {
      const favBtn = e.target.closest('.fav-btn');
      if (favBtn && favBtn.dataset.fav) {
        e.stopPropagation();
        toggleFavorite(favBtn.dataset.fav);
        return;
      }
      const card = e.target.closest('.card');
      if (card) openSaddle(card.dataset.id);
    });

    document.getElementById('favToggle').addEventListener('click', () => {
      favoritesMode = !favoritesMode && favorites.size > 0;
      renderHeaderFav();
      renderCatalog();
    });

    buildSheet();
    renderHeaderFav();
    const hash = decodeURIComponent(location.hash.slice(1));
    const fromHash = saddles.find(x => x.id === hash);
    if (fromHash) openSaddle(fromHash.id);
    else renderCatalog();
  } catch (e) {
    grid.innerHTML = '<div class="state">Не удалось загрузить каталог.<br>Обновите страницу.</div>';
    console.error(e);
  }
}

init();
