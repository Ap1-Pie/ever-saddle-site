'use strict';

/* Ever saddle - итерация 5: реальные данные канала.
   Прочерк (поля нет в JSON) - строка скрыта в карточке и не матчится фильтрами.
   В Телеграме - нативная BackButton и CloudStorage,
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
      if (!TG.CloudStorage || !TG.CloudStorage.getItem) return Promise.resolve([]);
      return new Promise(resolve => {
        try {
          TG.CloudStorage.getItem('favorites', (err, value) => {
            resolve(err || !value ? [] : value.split(',').filter(Boolean));
          });
        } catch (e) { resolve([]); }
      });
    }
    const v = localStorage.getItem('favorites');
    return Promise.resolve(v ? v.split(',').filter(Boolean) : []);
  },
  save() {
    const data = [...favorites].join(',');
    try {
      if (isTelegram) TG.CloudStorage?.setItem('favorites', data, () => {});
      else localStorage.setItem('favorites', data);
    } catch (e) { console.warn('Избранное не сохранено', e); }
  }
};

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  storage.save();
  haptic();
  renderHeaderFav();
  const cardBtn = document.getElementById('favCardBtn');
  if (!cardBtn.hidden && cardBtn.dataset.id === id) syncFavBtn(cardBtn, id); // открыта карточка
  else renderCatalog();
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

function syncFavBtn(btn, id) {
  const on = favorites.has(id);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? 'Убрать из избранного' : 'Добавить в избранное');
  btn.classList.toggle('is-on', on);
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
  if (field === 'color') {
    // двухцветное (черно-коричневое) матчится и с «черное», и с «коричневое»
    return (s.colorValues || (s.color !== undefined ? [s.color] : [])).map(String);
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
  if (filters.inStock && (s.status === 'sold' || s.status === 'reserved')) return false; // прочерк статуса = не продано = в наличии; забронированное тоже недоступно
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
  document.getElementById('applyBtn').addEventListener('click', closeSheets);
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
  document.getElementById('sheetOverlay').addEventListener('click', closeSheets);
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

function refreshApplyBtn() {
  const n = favoritesMode ? favoritesList().length : visibleSaddles().length;
  document.getElementById('applyBtn').textContent = 'Показать ' + n + ' ' + plural(n);
}

function refreshAfterFilterChange() {
  updateSheet();
  refreshApplyBtn();
  renderCatalog();
}

/* ---------- Сортировка каталога (идеи Ани №3 и №5) ---------- */

const CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="check" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const SORTS = [
  { key: 'new', label: 'Новые' },   // по умолчанию: свежие посты сверху, как раньше
  { key: 'old', label: 'Старые' },
  { key: 'priceAsc', label: 'Дешевле' },
  { key: 'priceDesc', label: 'Дороже' }
];
let sortMode = 'new';

function soldLast(a, b) {
  // проданные - всегда в конце, между собой только от новых к старым (решение Павла, 26.10);
  // активная сортировка применяется только к непроданным
  const aSold = a.status === 'sold', bSold = b.status === 'sold';
  if (aSold && bSold) return b.post - a.post;
  if (aSold) return 1;
  if (bSold) return -1;
  return 0;
}

const SORT_COMPARE = {
  new: (a, b) => soldLast(a, b) || b.post - a.post,
  old: (a, b) => soldLast(a, b) || a.post - b.post,
  // без цены (среди непроданных) - в конец ценового порядка;
  // пост - запасной критерий при равных ценах
  priceAsc: (a, b) => soldLast(a, b) || (a.price ?? Infinity) - (b.price ?? Infinity) || b.post - a.post,
  priceDesc: (a, b) => soldLast(a, b) || (b.price ?? -Infinity) - (a.price ?? -Infinity) || b.post - a.post
};

function sortList(list) {
  return [...list].sort(SORT_COMPARE[sortMode]);
}

function buildSortSheet() {
  document.getElementById('sortOptions').innerHTML = SORTS.map(o =>
    '<button type="button" class="sort-row" data-sort="' + o.key + '">' + esc(o.label) + CHECK_SVG + '</button>'
  ).join('');
  document.getElementById('sortOptions').addEventListener('click', (e) => {
    const row = e.target.closest('.sort-row');
    if (!row) return;
    sortMode = row.dataset.sort;
    haptic();
    closeSheets();
    updateSortBtn();
    renderCatalog();
  });
  document.getElementById('sortBtn').addEventListener('click', openSortSheet);
}

function updateSortBtn() {
  document.getElementById('sortLabel').textContent = SORTS.find(o => o.key === sortMode).label;
  document.getElementById('sortBtn').classList.toggle('is-on', sortMode !== 'new');
}

function openSortSheet() {
  document.querySelectorAll('#sortOptions .sort-row').forEach(row =>
    row.classList.toggle('on', row.dataset.sort === sortMode));
  document.getElementById('sheetOverlay').classList.add('open');
  document.getElementById('sortSheet').classList.add('open');
}

function closeSheets() {
  document.getElementById('sheetOverlay').classList.remove('open');
  document.getElementById('filterSheet').classList.remove('open');
  document.getElementById('sortSheet').classList.remove('open');
}

/* ---------- Полноэкранный просмотр фото (идея Ани №6) ---------- */

const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

let viewerState = null; // { photos, index, scale, tx, ty, pinch, pan, lastTap }

function isViewerOpen() {
  return document.getElementById('photoViewer').classList.contains('open');
}

function transformSlide(img, scale, tx, ty) {
  img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
}

// Зум вокруг точки экрана (px, py): точка фото под пальцами/курсором остается на месте.
// from* - состояние «до» (у pinch это база жеста, чтобы не дрейфовать от дрожания midpoint)
function zoomAround(img, fromScale, fromTx, fromTy, toScale, px, py) {
  const st = viewerState;
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const wx = (px - cx - fromTx) / fromScale;
  const wy = (py - cy - fromTy) / fromScale;
  toScale = Math.min(4, Math.max(1, toScale));
  const maxX = (toScale - 1) * window.innerWidth / 2;
  const maxY = (toScale - 1) * window.innerHeight / 2;
  st.scale = toScale;
  st.tx = Math.min(maxX, Math.max(-maxX, px - cx - wx * toScale));
  st.ty = Math.min(maxY, Math.max(-maxY, py - cy - wy * toScale));
  transformSlide(img, st.scale, st.tx, st.ty);
}

function viewerImg() {
  return document.querySelectorAll('#pTrack .p-slide img')[viewerState.index];
}

function resetViewerZoom() {
  const st = viewerState;
  st.scale = 1; st.tx = 0; st.ty = 0;
  const img = viewerImg();
  if (img) transformSlide(img, 1, 0, 0);
}

function updateViewerCounter() {
  const st = viewerState;
  document.getElementById('pCounter').textContent = (st.index + 1) + ' / ' + st.photos.length;
}

function openPhotoViewer(s, startIdx) {
  const root = document.getElementById('photoViewer');
  const slides = s.photos.map((p, i) =>
    '<div class="p-slide"><img src="' + esc(p) + '" alt="' + esc(s.title) + ' - фото ' + (i + 1) + '" draggable="false"></div>'
  ).join('');
  root.innerHTML =
    '<div class="p-top">' +
      '<span class="p-counter" id="pCounter"></span>' +
      '<button type="button" class="p-close" id="pClose" aria-label="Закрыть просмотр">' + CLOSE_SVG + '</button>' +
    '</div>' +
    '<div class="p-track" id="pTrack">' + slides + '</div>';
  viewerState = { photos: s.photos, index: startIdx, scale: 1, tx: 0, ty: 0 };
  root.classList.add('open'); // до scrollLeft: при display:none ширина трека 0
  document.body.classList.add('no-scroll');
  const track = document.getElementById('pTrack');
  track.scrollLeft = startIdx * track.clientWidth; // прыжок к фото без прокрутки
  updateViewerCounter();
  document.getElementById('pClose').addEventListener('click', closeViewer);
  wireViewerTrack(track);
  releaseTelegramButtons(); // нативные кнопки не должны висеть поверх фото
  showBackButton(backToCatalog); // первый «назад» закрывает просмотр
  haptic();
}

function wireViewerTrack(track) {
  const slides = [...track.querySelectorAll('.p-slide')];

  const pinchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const pinchMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

  track.addEventListener('touchstart', (e) => {
    const st = viewerState;
    if (e.touches.length === 2) {
      st.pinch = { dist: pinchDist(e.touches), scale: st.scale, tx: st.tx, ty: st.ty };
    } else if (e.touches.length === 1 && st.scale > 1) {
      st.pan = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: st.tx, ty: st.ty };
    }
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    const st = viewerState;
    if (!st) return;
    if (e.touches.length === 2 && st.pinch) {
      e.preventDefault(); // зум важнее прокрутки между фото
      const m = pinchMid(e.touches);
      const k = pinchDist(e.touches) / st.pinch.dist;
      zoomAround(viewerImg(), st.pinch.scale, st.pinch.tx, st.pinch.ty, st.pinch.scale * k, m.x, m.y);
    } else if (e.touches.length === 1 && st.pan) {
      e.preventDefault(); // при scale > 1 один палец - панорамирование, не свайп
      const p = st.pan;
      st.tx = p.tx + (e.touches[0].clientX - p.x);
      st.ty = p.ty + (e.touches[0].clientY - p.y);
      const maxX = (st.scale - 1) * window.innerWidth / 2;
      const maxY = (st.scale - 1) * window.innerHeight / 2;
      st.tx = Math.min(maxX, Math.max(-maxX, st.tx));
      st.ty = Math.min(maxY, Math.max(-maxY, st.ty));
      transformSlide(viewerImg(), st.scale, st.tx, st.ty);
    }
  }, { passive: false });

  track.addEventListener('touchend', (e) => {
    const st = viewerState;
    if (!st) return;
    if (e.touches.length === 0) {
      st.pinch = null; st.pan = null;
      if (st.scale < 1.05) resetViewerZoom(); // слабый щипок - просто вернуться
    } else if (e.touches.length === 1) {
      st.pinch = null;
      st.pan = st.scale > 1
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: st.tx, ty: st.ty }
        : null;
    }
  });

  // Переключение фото скроллом трека: сброс зума, обновление счетчика
  const syncIndex = () => {
    const st = viewerState;
    if (!st) return;
    const idx = Math.round(track.scrollLeft / track.clientWidth);
    if (idx === st.index) return;
    st.index = idx;
    st.scale = 1; st.tx = 0; st.ty = 0;
    slides.forEach((sl, i) => {
      if (i !== idx) transformSlide(sl.querySelector('img'), 1, 0, 0);
    });
    updateViewerCounter();
  };
  track.addEventListener('scroll', syncIndex, { passive: true });
  // Поллинг позиции: в части WebView (iOS Телеграма) scroll-события не доходят
  viewerState.pollTimer = setInterval(syncIndex, 150);

  // Колесо мыши (браузер на ПК): зум к позиции курсора
  track.addEventListener('wheel', (e) => {
    e.preventDefault();
    const st = viewerState;
    if (!st) return;
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    zoomAround(viewerImg(), st.scale, st.tx, st.ty, st.scale * factor, e.clientX, e.clientY);
  }, { passive: false });

  // Двойной тап/клик: приближение в точке и возврат
  track.addEventListener('click', (e) => {
    const st = viewerState;
    if (!st) return;
    const now = Date.now();
    const t = st.lastTap;
    st.lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (!t || now - t.t > 500 || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 40) return;
    st.lastTap = null;
    if (st.scale > 1) resetViewerZoom();
    else zoomAround(viewerImg(), 1, 0, 0, 2.5, e.clientX, e.clientY);
  });
}

function wireViewerStatics() {
  const root = document.getElementById('photoViewer');
  // Тап по пустому месту (не по фото) - закрыть
  root.addEventListener('click', (e) => {
    if (e.target.closest('.p-close') || e.target.tagName === 'IMG') return;
    closeViewer();
  });
  // Штатный pinch Safari не должен зумить страницу
  root.addEventListener('gesturestart', (e) => e.preventDefault());
  root.addEventListener('gesturechange', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isViewerOpen()) closeViewer();
  });
}

function closeViewer() {
  if (viewerState && viewerState.pollTimer) clearInterval(viewerState.pollTimer);
  viewerState = null;
  const root = document.getElementById('photoViewer');
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.classList.remove('no-scroll');
  if (document.querySelector('.saddle-view')) setupTelegramButtons(); // карточка под вьювером
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
  const reserved = s.status === 'reserved';
  const fav = favorites.has(s.id);
  const statusTag = sold ? '<span class="sold-tag">Продано</span>'
    : reserved ? '<span class="sold-tag reserved-tag">Забронировано</span>' : '';
  return (
    '<article class="card' + (sold ? ' sold' : '') + (reserved ? ' reserved' : '') + '" data-id="' + esc(s.id) + '">' +
      '<div class="photo"><img src="' + esc(s.photos[0]) + '" alt="' + esc(s.title) + '" loading="lazy"></div>' +
      statusTag +
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
  document.getElementById('favToggle').hidden = false;
  document.getElementById('favCardBtn').hidden = true;
  // В Телеграме из избранного ведет нативная «Назад», строка «Каталог» - только в браузере
  document.getElementById('favBack').hidden = !favoritesMode || isTelegram;
  const grid = document.getElementById('grid');
  grid.classList.remove('saddle-open');
  document.querySelector('.toolbar').style.display = '';
  let list, empty = null;
  if (favoritesMode) {
    list = sortList(favoritesList());
    if (list.length === 0) empty = EMPTY_FAV_SVG + '<h3>Пока пусто</h3><p>Нажмите на сердце у седла в каталоге - оно появится здесь</p>';
  } else {
    list = sortList(visibleSaddles());
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
  if (favoritesMode) showBackButton(exitFavorites); // «Назад» вместо «Закрыть» в fullscreen
}

/* ---------- Карточка седла ---------- */

function fieldRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return '<div class="s-row"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
}

function saddleHtml(s) {
  const sold = s.status === 'sold';
  const reserved = s.status === 'reserved';
  const brandModel = [s.brand, s.model].filter(Boolean).join(', ');
  const slides = s.photos.map(p =>
    '<div class="g-slide"><img src="' + esc(p) + '" alt="' + esc(s.title) + '"></div>'
  ).join('');
  const dots = s.photos.map((_, i) =>
    '<span class="dot' + (i === 0 ? ' on' : '') + '"></span>'
  ).join('');
  const statusTag = sold ? '<span class="sold-tag sold-tag-big">Продано</span>'
    : reserved ? '<span class="sold-tag sold-tag-big reserved-tag">Забронировано</span>' : '';
  return (
    '<div class="saddle-view' + (sold ? ' sold' : '') + (reserved ? ' reserved' : '') + '">' +
      // сердце седла - в шапке приложения (итерация 16); строка «назад» нужна только в браузере
      (!isTelegram
        ? '<div class="s-head">' +
            '<button type="button" class="back-btn" id="backBtn">' +
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>' +
              'Каталог' +
            '</button>' +
          '</div>'
        : '') +
      '<div class="gallery">' +
        '<div class="g-track" id="gTrack">' + slides + '</div>' +
        statusTag +
      '</div>' +
      '<div class="dots" id="gDots">' + dots + '</div>' +
      '<h1 class="s-title">' + esc(s.title) + '</h1>' +
      '<div class="s-meta">' +
        '<button type="button" class="copy-article" id="copyArticle" aria-label="Скопировать артикул ' + esc(s.article || '') + '">' + esc(s.article || '') + '</button>' +
        (s.publishedAt ? '<span class="s-date">' + esc(s.publishedAt) + '</span>' : '') +
      '</div>' +
      priceHtml(s, 's-price') +
      '<dl class="s-rows">' +
        fieldRow('Тип', s.type) +
        fieldRow('Бренд и модель', brandModel) +
        fieldRow('Размер всаднику', typeof s.sizeRider === 'number' ? String(s.sizeRider).replace('.', ',') : s.sizeRider) +
        fieldRow('Размер лошади', s.sizeHorse) +
        fieldRow('Материал', s.material) +
        fieldRow('Цвет', s.color) +
        fieldRow('Состояние', s.condition) +
      '</dl>' +
      (s.description
        ? '<div class="s-desc"><h3>Описание</h3><p>' + esc(s.description).replace(/\n/g, '<br>') + '</p></div>'
        : '') +
      '<a class="dm-btn" href="' + DM_URL + '"' +
        (isTelegram ? '' : ' target="_blank" rel="noopener"') + '>Написать</a>' +
    '</div>'
  );
}

let galleryTimer = null;
let galleryObserver = null;

function stopGalleryTracking() {
  if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }
}

function wireCopyArticle() {
  const btn = document.getElementById('copyArticle');
  if (!btn || !btn.textContent) return;
  const article = btn.textContent;
  btn.addEventListener('click', async () => {
    let ok = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(article); ok = true; } catch (e) { /* WebView без разрешения */ }
    }
    if (!ok) {
      // запасной путь для старых WebView Телеграма
      const ta = document.createElement('textarea');
      ta.value = article;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      ta.remove();
    }
    haptic();
    if (ok) {
      btn.textContent = 'Скопировано';
      setTimeout(() => { if (btn.isConnected) btn.textContent = article; }, 1200);
    }
  });
}

function wireGallery(s) {
  stopGalleryTracking();
  const track = document.getElementById('gTrack');
  const dots = [...document.querySelectorAll('#gDots .dot')];
  if (!track) return;
  // Тап по фото - полноэкранный просмотр с текущего снимка
  track.addEventListener('click', (e) => {
    const slide = e.target.closest('.g-slide');
    if (!slide) return;
    openPhotoViewer(s, [...track.querySelectorAll('.g-slide')].indexOf(slide));
  });
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
  showBackButton(backToCatalog);
  TG.MainButton.hide();
}

function releaseTelegramButtons() {
  if (!isTelegram) return;
  TG.MainButton.hide();
  hideBackButton();
}

// Нативная кнопка «Назад» (в fullscreen - верхняя левая вместо «Закрыть»):
// один обработчик за раз, у Телеграма onClick копится
function showBackButton(handler) {
  if (!isTelegram) return;
  TG.BackButton.offClick(backToCatalog);
  TG.BackButton.offClick(exitFavorites);
  TG.BackButton.onClick(handler);
  TG.BackButton.show();
}

function hideBackButton() {
  if (!isTelegram) return;
  TG.BackButton.offClick(backToCatalog);
  TG.BackButton.offClick(exitFavorites);
  TG.BackButton.hide();
}

function exitFavorites() {
  favoritesMode = false;
  renderHeaderFav();
  renderCatalog();
}

/* ---------- Переходы ---------- */

function openSaddle(id, pushHistory = true) {
  const s = saddles.find(x => x.id === id);
  if (!s) return;
  closeSheets();
  document.querySelector('.toolbar').style.display = 'none';
  document.getElementById('favToggle').hidden = true;
  document.getElementById('favBack').hidden = true;
  const favCard = document.getElementById('favCardBtn');
  favCard.dataset.id = id;
  syncFavBtn(favCard, id);
  favCard.hidden = false; // сердце седла - в шапке, на месте глобального
  const grid = document.getElementById('grid');
  grid.classList.add('saddle-open');
  grid.innerHTML = saddleHtml(s);
  if (isTelegram) {
    grid.querySelector('.dm-btn').addEventListener('click', (e) => {
      e.preventDefault();
      TG.openTelegramLink(DM_URL);
    });
  }
  const back = document.getElementById('backBtn');
  if (back) back.addEventListener('click', backToCatalog);
  wireCopyArticle();
  wireGallery(s);
  setupTelegramButtons();
  window.scrollTo(0, 0);
  if (pushHistory) history.pushState({ view: 'saddle', id }, '', '#' + encodeURIComponent(id));
}

function backToCatalog() {
  if (isViewerOpen()) { closeViewer(); return; } // первый «назад» закрывает только фото
  renderCatalog();
  history.pushState({ view: 'catalog' }, '', location.pathname);
}

window.addEventListener('popstate', () => {
  if (isViewerOpen()) closeViewer();
  const id = decodeURIComponent(location.hash.slice(1));
  if (saddles.some(s => s.id === id)) openSaddle(id, false);
  else renderCatalog();
});

/* ---------- Старт ---------- */

async function init() {
  if (TG) {
    TG.ready();
    TG.expand();
    // Полноэкранный режим (Bot API 8.0): прячет шапку Телеграма с крестиком и точками,
    // как в топовых мини-аппах. Отступ контента сверху считает CSS в .app из четырех
    // источников (env, переменная Телеграма, --safe-top, --fs-top): часть клиентов
    // в fullscreen отдает нулевой contentSafeAreaInset, поэтому держим и фикс-запас.
    if (TG.requestFullscreen && TG.contentSafeAreaInset) {
      try {
        const applySafeTop = () => {
          const root = document.documentElement.style;
          root.setProperty('--safe-top', (TG.contentSafeAreaInset.top || 0) + 'px');
          root.setProperty('--fs-top', TG.isFullscreen ? '52px' : '0px');
        };
        TG.requestFullscreen();
        applySafeTop();
        TG.onEvent('fullscreenChanged', applySafeTop);
        TG.onEvent('contentSafeAreaChanged', applySafeTop);
      } catch (e) { console.warn('Полноэкранный режим недоступен', e); }
    }
  }
  const grid = document.getElementById('grid');
  try {
    try { favorites = new Set(await storage.load()); }
    catch (e) { console.warn('Избранное не загружено', e); }
    const res = await fetch('data/saddles.json' + (window.ASSETS_V || ''));
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
      favoritesMode = !favoritesMode; // пустое избранное тоже открывается - с подсказкой
      renderHeaderFav();
      renderCatalog();
    });

    document.getElementById('favCardBtn').addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (id) toggleFavorite(id);
    });

    document.getElementById('favBackBtn').addEventListener('click', exitFavorites); // браузер

    buildSheet();
    buildSortSheet();
    wireViewerStatics();
    renderHeaderFav();
    const hash = decodeURIComponent(location.hash.slice(1));
    const fromHash = saddles.find(x => x.id === hash);
    if (fromHash) openSaddle(fromHash.id, false);
    else renderCatalog();
  } catch (e) {
    grid.innerHTML = '<div class="state">Не удалось загрузить каталог.<br>Обновите страницу.</div>';
    console.error(e);
  }
}

init();
