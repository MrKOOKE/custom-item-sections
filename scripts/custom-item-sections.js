// Константы модуля
const MODULE_ID = 'custom-item-sections';
const PAPER_DOLL_MODULE_ID = 'blok-upravleniya';
const PAPER_DOLL_HIDE_INVENTORY_FLAG = 'paperDollHiddenInInventory';
const CELL_INVENTORY = Object.freeze({
  columns: 10,
  rows: 10,
  cellSize: 100
});
const CELL_INVENTORY_SORT_MODES = Object.freeze({
  CATEGORY: 'category',
  NAME_ASC: 'name-asc',
  NAME_DESC: 'name-desc'
});
const FLAGS = {
  SECTION: 'section',
  NON_STACKABLE: 'nonStackable',
  WEIGHT_REDUCTION: 'contentWeightReduction',
  CATEGORY_MODE: 'categoryMode', // 'allow' | 'deny'
  CATEGORY_LIST: 'categoryList',
  GRID_POSITION: 'inventoryGridPosition',
  GRID_SORT_MODE: 'cellInventorySortMode',
  GRID_SIZE_X: 'inventoryGridSizeX',
  GRID_SIZE_Y: 'inventoryGridSizeY',
  CONTAINER_GRID_X: 'containerGridSizeX',
  CONTAINER_GRID_Y: 'containerGridSizeY'
};

// Управление логированием: по умолчанию тихо; включается настройкой 'debugLogs'
function logDebug(message, ...args) {
  try {
    if (!game?.settings?.get?.(MODULE_ID, 'debugLogs')) return;
  } catch (_) { return; }
  console.debug(`${MODULE_ID} | ${message}`, ...args);
}

// Храним раскрытые контейнеры в рамках сессии (по актеру)
const expandedContainersByActor = new Map();
// Безопасная локализация: если ключа нет — вернём осмысленный fallback
function localizeSafe(key, fallback) {
  try {
    if (game.i18n?.has?.(key)) return game.i18n.localize(key);
    const loc = game.i18n?.localize?.(key);
    if (loc && loc !== key) return loc;
  } catch (_) { /* ignore */ }
  if (fallback !== undefined) return fallback;
  const lang = (game.i18n?.lang ?? '').toLowerCase();
  return lang.startsWith('ru') ? 'Пусто' : 'Empty';
}
// Чтобы не дублировать обработчики на одних и тех же DOM-зонах
function formatLocalizeSafe(key, data, fallback) {
  try {
    if (game.i18n?.has?.(key)) return game.i18n.format(key, data);
  } catch (_) { /* ignore */ }
  if (fallback !== undefined) return fallback;
  return key;
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function isCellInventoryEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, 'enableCellInventory');
  } catch (_) {
    return false;
  }
}
function isIconGridInventoryEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, 'enableGridInventory');
  } catch (_) {
    return false;
  }
}

function isPaperDollInventoryHidden(itemLike) {
  try {
    if (typeof itemLike?.getFlag === 'function') {
      return itemLike.getFlag(PAPER_DOLL_MODULE_ID, PAPER_DOLL_HIDE_INVENTORY_FLAG) === true;
    }
  } catch (_) { /* ignore */ }
  return foundry.utils.getProperty(itemLike, `flags.${PAPER_DOLL_MODULE_ID}.${PAPER_DOLL_HIDE_INVENTORY_FLAG}`) === true;
}

function shouldHideItemFromCellInventory(itemLike) {
  return isPaperDollInventoryHidden(itemLike) || Boolean(itemLike?.system?.equipped);
}

function hideActiveTooltip() {
  try {
    requestAnimationFrame(() => game.tooltip?.deactivate?.());
    game.tooltip?.deactivate?.();
  } catch (_) { /* ignore */ }
}
const wiredDropZones = new WeakSet();
// Сохранённые позиции прокрутки для листов предметов (по ID предмета)
const savedItemSheetScroll = new Map();
const cellInventoryPositionCacheByActor = new Map();
let activeCellInventoryDrag = null;
let transparentDragImage = null;
let ownedItemDragPreview = null;
const pendingAutoUnequipPlacementTimers = new Map();
const openContainerWindows = new Map();
const actorSheetPrioritySyncByActor = new Map();
let containerWindowFocusCounter = 0;
const CONTAINER_WINDOW = Object.freeze({
  minCellSize: 56,
  maxCellSize: 100,
  preferredCellSize: 92,
  minWidth: 360,
  minHeight: 320,
  widthPadding: 92,
  heightPadding: 228,
  viewportWidthRatio: 0.92,
  viewportHeightRatio: 0.88
});

function getExpandedContainersForActor(actorId) {
  if (!expandedContainersByActor.has(actorId)) expandedContainersByActor.set(actorId, new Set());
  return expandedContainersByActor.get(actorId);
}

function getTransparentDragImage() {
  if (transparentDragImage) return transparentDragImage;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  transparentDragImage = canvas;
  return transparentDragImage;
}

function normalizeOwnedItemDragOptions(extra = {}) {
  const options = (extra && typeof extra === 'object' && !Array.isArray(extra)) ? extra : {};
  const {
    sourceElement = null,
    ...dragDataExtra
  } = options;

  return { sourceElement, dragDataExtra };
}

function getOwnedItemDragSourceElement(event, explicitSource = null) {
  if (explicitSource instanceof HTMLElement) return explicitSource;

  if (event?.currentTarget instanceof HTMLElement) return event.currentTarget;
  if (event?.target instanceof HTMLElement) return event.target;
  if (event?.originalEvent?.currentTarget instanceof HTMLElement) return event.originalEvent.currentTarget;
  if (event?.originalEvent?.target instanceof HTMLElement) return event.originalEvent.target;

  return null;
}

function getOwnedItemDragPreviewDocument(sourceElement = null, nativeEvent = null) {
  return sourceElement?.ownerDocument
    ?? nativeEvent?.view?.document
    ?? document;
}

function ensureOwnedItemDragPreview(doc = document) {
  if (ownedItemDragPreview?.ownerDocument === doc && ownedItemDragPreview.isConnected) return ownedItemDragPreview;

  ownedItemDragPreview = doc.createElement('div');
  ownedItemDragPreview.className = 'cis-owned-item-drag-image';
  ownedItemDragPreview.setAttribute('aria-hidden', 'true');
  ownedItemDragPreview.innerHTML = `
    <div class="cis-owned-item-drag-image-card">
      <img class="cis-owned-item-drag-image-asset" alt="" />
      <span class="cis-owned-item-drag-image-qty"></span>
    </div>
  `;

  (doc.body ?? doc.documentElement)?.appendChild(ownedItemDragPreview);
  return ownedItemDragPreview;
}

function normalizeOwnedItemDragPreviewSize(width, height) {
  let normalizedWidth = Math.max(1, Math.round(Number(width) || 0));
  let normalizedHeight = Math.max(1, Math.round(Number(height) || 0));

  if (!(normalizedWidth > 0) || !(normalizedHeight > 0)) {
    normalizedWidth = 96;
    normalizedHeight = 96;
  }

  const minSide = 48;
  const maxSide = 220;
  const minCurrentSide = Math.min(normalizedWidth, normalizedHeight);
  const maxCurrentSide = Math.max(normalizedWidth, normalizedHeight);

  let scale = 1;
  if (maxCurrentSide > maxSide) scale = Math.min(scale, maxSide / maxCurrentSide);
  if (minCurrentSide > 0 && minCurrentSide < minSide) scale = Math.max(scale, minSide / minCurrentSide);

  return {
    width: Math.max(1, Math.round(normalizedWidth * scale)),
    height: Math.max(1, Math.round(normalizedHeight * scale)),
    scale
  };
}

function parseOwnedItemDragPixelValue(value) {
  const numeric = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function getOwnedItemDragPreviewCellSize(sourceElement = null) {
  const doc = sourceElement?.ownerDocument ?? document;
  const roots = [
    sourceElement?.closest?.('.window-app'),
    sourceElement?.closest?.('.app'),
    sourceElement?.closest?.('.cis-tarkov-shell'),
    doc
  ].filter(Boolean);

  for (const root of roots) {
    const cell = root?.querySelector?.('.cis-cell-inventory-cell');
    const rect = cell?.getBoundingClientRect?.();
    const width = Number(rect?.width) || 0;
    const height = Number(rect?.height) || 0;
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  const styleTargets = [
    sourceElement?.closest?.('.cis-tarkov-shell'),
    sourceElement?.closest?.('.window-app'),
    sourceElement,
    doc?.documentElement
  ].filter(Boolean);

  for (const target of styleTargets) {
    try {
      const computed = getComputedStyle(target);
      const size = parseOwnedItemDragPixelValue(computed?.getPropertyValue('--cis-cell-size'));
      if (size) return { width: size, height: size };
    } catch (_) { /* ignore */ }
  }

  return {
    width: CELL_INVENTORY.cellSize,
    height: CELL_INVENTORY.cellSize
  };
}

function getOwnedItemDragPreviewMetrics(item, sourceElement = null) {
  const itemSize = getCellInventorySize(item);
  const cellSize = getOwnedItemDragPreviewCellSize(sourceElement);
  const rawWidth = Math.max(1, itemSize.width * cellSize.width);
  const rawHeight = Math.max(1, itemSize.height * cellSize.height);
  const normalizedSize = normalizeOwnedItemDragPreviewSize(rawWidth, rawHeight);
  const scale = Number(normalizedSize.scale) || 1;

  return {
    width: normalizedSize.width,
    height: normalizedSize.height,
    cellWidth: Math.max(1, Math.round(cellSize.width * scale)),
    cellHeight: Math.max(1, Math.round(cellSize.height * scale)),
    columns: itemSize.width,
    rows: itemSize.height
  };
}

function updateOwnedItemDragPreview(preview, item, sourceElement = null) {
  if (!preview || !item) {
    return {
      width: 96,
      height: 96,
      cellWidth: 96,
      cellHeight: 96,
      columns: 1,
      rows: 1
    };
  }

  const size = getOwnedItemDragPreviewMetrics(item, sourceElement);
  const image = preview.querySelector('.cis-owned-item-drag-image-asset');
  const qty = preview.querySelector('.cis-owned-item-drag-image-qty');
  const quantity = Number(item.system?.quantity ?? 1);

  preview.style.width = `${size.width}px`;
  preview.style.height = `${size.height}px`;
  preview.style.setProperty('--cis-owned-item-drag-cell-width', `${size.cellWidth}px`);
  preview.style.setProperty('--cis-owned-item-drag-cell-height', `${size.cellHeight}px`);
  preview.style.setProperty('--cis-owned-item-drag-columns', String(size.columns));
  preview.style.setProperty('--cis-owned-item-drag-rows', String(size.rows));

  if (image) {
    image.src = item.img || '';
    image.alt = item.name || '';
  }

  if (qty) {
    qty.textContent = quantity > 1 ? String(quantity) : '';
    qty.hidden = quantity <= 1;
  }

  return size;
}

function setActiveCellInventoryDrag(state) {
  activeCellInventoryDrag = state ? {
    actorId: state.actorId ?? null,
    itemId: state.itemId ?? null,
    size: sanitizeCellInventorySize(state.size),
    type: state.type ?? 'Item'
  } : null;
}

function buildOwnedItemDragData(actor, item, extra = {}) {
  return {
    type: 'Item',
    id: item?.id ?? null,
    uuid: item?.uuid ?? null,
    actorId: actor?.id ?? null,
    actorUuid: actor?.uuid ?? null,
    ...extra
  };
}

function beginOwnedItemSheetDrag(actor, item, event, extra = {}) {
  const nativeEvent = event?.originalEvent ?? event;
  if (!actor || !item || !nativeEvent?.dataTransfer) return null;
  const { sourceElement, dragDataExtra } = normalizeOwnedItemDragOptions(extra);
  const dragSourceElement = getOwnedItemDragSourceElement(event, sourceElement);

  hideActiveTooltip();

  const dragData = buildOwnedItemDragData(actor, item, dragDataExtra);
  nativeEvent.dataTransfer.setData('text/plain', JSON.stringify(dragData));
  nativeEvent.dataTransfer.effectAllowed = 'copyMove';
  try {
    const dragPreview = ensureOwnedItemDragPreview(getOwnedItemDragPreviewDocument(dragSourceElement, nativeEvent));
    const dragPreviewSize = updateOwnedItemDragPreview(dragPreview, item, dragSourceElement);
    nativeEvent.dataTransfer.setDragImage(
      dragPreview,
      Math.round(dragPreviewSize.width / 2),
      Math.round(dragPreviewSize.height / 2)
    );
  } catch (_) {
    try {
      nativeEvent.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
    } catch (_) { /* ignore */ }
  }

  setActiveCellInventoryDrag({
    actorId: actor.id,
    itemId: item.id,
    size: getCellInventorySize(item),
    type: 'Item'
  });

  scheduleBringOpenContainerWindowsToFront(actor);

  return dragData;
}

function finishOwnedItemSheetDrag() {
  setActiveCellInventoryDrag(null);
}

function isPaperDollSourceDropData(dropData) {
  return Boolean(dropData?.fromSlot || dropData?.fromEchSet);
}

async function normalizePaperDollDraggedItem(app, droppedItem, dropData = null, updateOptions = {}) {
  if (!app?.actor || !droppedItem || droppedItem.parent !== app.actor) return droppedItem;
  if (!isPaperDollSourceDropData(dropData) && !isPaperDollInventoryHidden(droppedItem)) return droppedItem;

  const updateData = {};
  if (droppedItem.system?.equipped) updateData['system.equipped'] = false;
  updateData[`flags.${PAPER_DOLL_MODULE_ID}.${PAPER_DOLL_HIDE_INVENTORY_FLAG}`] = false;

  await droppedItem.update(updateData, updateOptions);
  return app.actor.items.get(droppedItem.id) ?? droppedItem;
}

async function movePaperDollDraggedItemToCell(app, droppedItem, position, dropData = null) {
  if (!app?.actor || !droppedItem || droppedItem.parent !== app.actor) return false;

  const size = getCellInventorySize(droppedItem);
  const normalized = sanitizeCellInventoryPosition(position, size);
  if (!normalized) {
    warnCellInventoryDoesNotFit();
    return false;
  }

  const layoutState = collectCellInventoryLayoutState(app.actor);
  const placementState = getCellInventoryPlacementState(layoutState, normalized, size, new Set([droppedItem.id]));
  if (!placementState.isValid) {
    warnCellInventoryDoesNotFit();
    return false;
  }

  const updateData = {
    _id: droppedItem.id,
    "system.container": null,
    [`flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`]: placementState.position
  };

  if (isPaperDollSourceDropData(dropData) || isPaperDollInventoryHidden(droppedItem)) {
    if (droppedItem.system?.equipped) updateData["system.equipped"] = false;
    updateData[`flags.${PAPER_DOLL_MODULE_ID}.${PAPER_DOLL_HIDE_INVENTORY_FLAG}`] = false;
  }

  await app.actor.updateEmbeddedDocuments("Item", [updateData], {
    cisSkipAutoUnequipPlacement: true
  });
  return true;
}

function getCellInventoryPositionCache(actorId) {
  if (!actorId) return null;
  if (!cellInventoryPositionCacheByActor.has(actorId)) {
    cellInventoryPositionCacheByActor.set(actorId, new Map());
  }
  return cellInventoryPositionCacheByActor.get(actorId);
}

function clearCellInventoryPositionCache(actorId) {
  if (!actorId) return;
  cellInventoryPositionCacheByActor.delete(actorId);
}

function getAutoUnequipPlacementKey(actorId, itemId) {
  if (!actorId || !itemId) return null;
  return `${actorId}:${itemId}`;
}

function scheduleAutoUnequippedItemPlacement(item) {
  const actor = item?.parent;
  const key = getAutoUnequipPlacementKey(actor?.id, item?.id);
  if (!key || !actor?.isOwner) return;

  const existingTimer = pendingAutoUnequipPlacementTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    pendingAutoUnequipPlacementTimers.delete(key);
    try {
      await autoPlaceUnequippedItemInRoot(actor, item.id);
    } catch (error) {
      console.error(`${MODULE_ID} | autoPlaceUnequippedItemInRoot failed`, error);
    }
  }, 0);

  pendingAutoUnequipPlacementTimers.set(key, timer);
}

async function autoPlaceUnequippedItemInRoot(actor, itemId) {
  if (!actor?.isOwner || !itemId || !isCellInventoryEnabled()) return;

  const item = actor.items.get(itemId);
  if (!item || item.system?.equipped) return;

  const updateData = { _id: item.id };
  let hasChanges = false;

  if (item.system?.container) {
    const mergeTarget = findMergeTarget(actor, item, null);
    if (mergeTarget) {
      await mergeTarget.update({
        'system.quantity': Number(mergeTarget.system?.quantity ?? 0) + Number(item.system?.quantity ?? 1)
      }, {
        cisSkipAutoUnequipPlacement: true
      });
      await item.delete();
      return;
    }

    const layoutState = collectCellInventoryLayoutState(actor);
    const position = findNextFreeCellInventoryPosition(
      layoutState.occupiedCells,
      getCellInventorySize(item),
      layoutState.gridDimensions
    );

    if (position) {
      updateData['system.container'] = null;
      updateData[`flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`] = position;
      hasChanges = true;
    }
  }

  if (isPaperDollInventoryHidden(item)) {
    updateData[`flags.${PAPER_DOLL_MODULE_ID}.${PAPER_DOLL_HIDE_INVENTORY_FLAG}`] = false;
    hasChanges = true;
  }

  if (!hasChanges) return;

  await actor.updateEmbeddedDocuments('Item', [updateData], {
    cisSkipAutoUnequipPlacement: true
  });
}

// Инициализация модуля
Hooks.once('init', () => {
  logDebug('Инициализация модуля Custom Item Sections');
  
  // Регистрируем настройки, если необходимо
  registerSettings();
  
  // Добавляем глобальные обработчики для блокировки редактирования количества
  setupInventoryControlHandlers();

  // Стабилизация прокрутки листов актёров DnD5e, чтобы окно не "дёргалось" при переносе предметов
  installScrollStabilizer();

  // Патч логики веса контейнера ставим на init — чтобы сработало до первого пересчёта энкамбранса
  try {
    installContainerWeightReductionPatch();
  } catch (e) {
    console.warn(`${MODULE_ID} | early patch failed`, e);
  }
});

// Дублируем установку патча на стадии setup, чтобы гарантировать наличие моделей данных dnd5e до первого prepareData
Hooks.once('setup', () => {
  try {
    installContainerWeightReductionPatch();
  } catch (e) {
    console.warn(`${MODULE_ID} | setup patch failed`, e);
  }
});

Hooks.on('updateItem', (item, changed, options = {}) => {
  const actor = item?.parent;
  if (!actor?.isOwner) return;
  if (options?.cisSkipAutoUnequipPlacement || options?.paperDollInventorySync) return;
  if (foundry.utils.getProperty(changed, 'system.equipped') !== false) return;
  if (!item.system?.container && !isPaperDollInventoryHidden(item)) return;

  scheduleAutoUnequippedItemPlacement(item);
});

// Функция настройки обработчиков контроля инвентаря
Hooks.on('dnd5e.getItemContextOptions', (item, menuItems) => {
  if (!isOpenableContainerItem(item)) return;

  const openMenuItem = {
    name: localizeSafe('CUSTOM_SECTIONS.OpenContainer', 'Открыть'),
    icon: "<i class='fas fa-box-open fa-fw'></i>",
    condition: () => isOpenableContainerItem(item),
    callback: () => {
      openContainerWindow(item);
    },
    group: 'action'
  };

  let insertIndex = -1;
  for (let i = 0; i < menuItems.length; i += 1) {
    const menuItem = menuItems[i];
    if (menuItem?.name === 'DND5E.ContextMenuActionDuplicate'
      || menuItem?.name === 'DND5E.ContextMenuActionEdit'
      || (typeof menuItem?.callback === 'function' && menuItem.callback.toString().includes('duplicate'))) {
      insertIndex = i + 1;
    }
  }

  if (insertIndex < 0) insertIndex = Math.min(3, menuItems.length);
  menuItems.splice(insertIndex, 0, openMenuItem);
});

function setupInventoryControlHandlers() {
  // Добавляем обработчик события click для перехвата кликов по кнопкам + и - в кастомных секциях
  $(document).on("click", "[data-custom-section] .adjustment-button", function(event) {
    // Пропускаем обработку для GM
    if (game.user.isGM) return;
    
    // Предотвращаем стандартное поведение
    event.preventDefault();
    event.stopPropagation();
    
    // Уведомляем пользователя
    ui.notifications.warn("Только GM может изменять количество предметов");
    
    return false;
  });
  
  // Добавляем обработчик события change для полей ввода количества в кастомных секциях
  $(document).on("change", "[data-custom-section] input[data-name='system.quantity']", function(event) {
    // Пропускаем обработку для GM
    if (game.user.isGM) return;
    
    // Получаем исходное значение из атрибута data-prev-value
    const prevValue = $(this).attr("data-prev-value");
    
    // Если предыдущее значение доступно, восстанавливаем его
    if (prevValue !== undefined) {
      $(this).val(prevValue);
    }
    
    // Предотвращаем стандартное поведение
    event.preventDefault();
    event.stopPropagation();
    
    // Уведомляем пользователя
    ui.notifications.warn("Только GM может изменять количество предметов");
    
    return false;
  });
}

// Регистрация настроек модуля
function registerSettings() {
  game.settings.register(MODULE_ID, 'enableCustomSections', {
    name: 'CUSTOM_SECTIONS.Settings.EnableCustomSections.Name',
    hint: 'CUSTOM_SECTIONS.Settings.EnableCustomSections.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Переключатель сетчатого вида инвентаря
  game.settings.register(MODULE_ID, 'enableCellInventory', {
    name: 'CUSTOM_SECTIONS.Settings.EnableCellInventory.Name',
    hint: 'CUSTOM_SECTIONS.Settings.EnableCellInventory.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, 'enableGridInventory', {
    name: 'CUSTOM_SECTIONS.Settings.EnableGridInventory.Name',
    hint: 'CUSTOM_SECTIONS.Settings.EnableGridInventory.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // Скрытая настройка для детализированных логов
  game.settings.register(MODULE_ID, 'debugLogs', {
    name: 'Debug logging',
    hint: 'Write verbose debug logs to the console',
    scope: 'client',
    config: false,
    type: Boolean,
    default: false
  });
}

const SCROLL_STABILIZER_EXTRA_SELECTORS = Object.freeze([
  '.window-content',
  '.items-list',
  '.inventory-list',
  '.effects-list',
  'dnd5e-inventory .inventory-list',
  'dnd5e-effects .effects-list',
  '.form-body',
  '.center-pane',
  '.sheet-body',
  '.tab.active',
  '.cis-loadout-pane',
  '.cis-inventory-pane',
  '.cis-cell-inventory-scroll',
  '.cis-cell-inventory-panel-scroll',
  '.cis-container-window-grid-host'
]);

const SCROLL_STABILIZER_DATA_KEYS = Object.freeze([
  'tab',
  'scopeType',
  'containerId',
  'itemId',
  'action',
  'echSet',
  'id',
  'index'
]);

const SCROLL_STABILIZER_CLASS_NAMES = new Set([
  'window-content',
  'sheet-body',
  'items-list',
  'inventory-list',
  'effects-list',
  'tab',
  'active',
  'cis-loadout-pane',
  'cis-inventory-pane',
  'cis-cell-inventory-scroll',
  'cis-cell-inventory-panel-scroll',
  'cis-cell-inventory-shell',
  'cis-cell-inventory-content',
  'cis-cell-inventory-panels',
  'cis-cell-inventory-root-scope',
  'cis-container-window-grid-host',
  'cis-container-window-root'
]);

function getScrollStabilizerSelectors(app) {
  const configured = Array.isArray(app?.options?.scrollY) ? app.options.scrollY : [];
  return Array.from(new Set([...configured, ...SCROLL_STABILIZER_EXTRA_SELECTORS]));
}

function matchesScrollStabilizerSelector(element, selectors = []) {
  if (!element?.matches || !selectors.length) return false;
  for (const selector of selectors) {
    try {
      if (element.matches(selector)) return true;
    } catch (_) { /* ignore invalid selector */ }
  }
  return false;
}

function buildScrollStabilizerPath(element, root) {
  if (!element || !root) return null;
  if (element === root) return [];

  const path = [];
  let current = element;
  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }

  return current === root ? path : null;
}

function resolveScrollStabilizerPath(root, path = []) {
  if (!root) return null;
  let current = root;
  for (const index of path) {
    if (!current?.children || index < 0 || index >= current.children.length) return null;
    current = current.children[index];
  }
  return current;
}

function captureScrollStabilizerSignature(element) {
  const dataset = {};
  for (const key of SCROLL_STABILIZER_DATA_KEYS) {
    const value = element?.dataset?.[key];
    if (typeof value === 'string' && value !== '') dataset[key] = value;
  }

  const classes = Array.from(element?.classList ?? [])
    .filter((className) => className.startsWith('cis-') || SCROLL_STABILIZER_CLASS_NAMES.has(className))
    .sort()
    .slice(0, 8);

  return {
    tagName: element?.tagName ?? null,
    id: element?.id || null,
    classes,
    dataset
  };
}

function doesScrollStabilizerSignatureMatch(element, signature = {}) {
  if (!element || !signature?.tagName) return false;
  if (element.tagName !== signature.tagName) return false;
  if (signature.id && element.id !== signature.id) return false;

  for (const className of signature.classes ?? []) {
    if (!element.classList?.contains(className)) return false;
  }

  for (const [key, value] of Object.entries(signature.dataset ?? {})) {
    if (element.dataset?.[key] !== value) return false;
  }

  return true;
}

function findScrollStabilizerElementBySignature(root, signature = {}) {
  if (!root || !signature?.tagName) return null;
  const hasStableMarker = Boolean(
    signature.id
    || (signature.classes?.length)
    || Object.keys(signature.dataset ?? {}).length
  );
  if (!hasStableMarker) return null;
  const candidates = root.querySelectorAll(signature.tagName);
  for (const candidate of candidates) {
    if (doesScrollStabilizerSignatureMatch(candidate, signature)) return candidate;
  }
  return null;
}

function resolveScrollStabilizerElement(root, state) {
  if (!root || !state) return null;

  const fromPath = resolveScrollStabilizerPath(root, state.path);
  if (doesScrollStabilizerSignatureMatch(fromPath, state.signature)) return fromPath;

  return findScrollStabilizerElementBySignature(root, state.signature);
}

function collectScrollStabilizerState(root, selectors = []) {
  if (!root?.querySelectorAll) return [];

  const states = [];
  const elements = [root, ...root.querySelectorAll('*')];

  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;

    const top = Math.round(Number(element.scrollTop) || 0);
    const left = Math.round(Number(element.scrollLeft) || 0);
    if (!top && !left) continue;

    const isTracked = matchesScrollStabilizerSelector(element, selectors);
    const canScrollVertically = (element.scrollHeight - element.clientHeight) > 1;
    const canScrollHorizontally = (element.scrollWidth - element.clientWidth) > 1;
    if (!isTracked && !canScrollVertically && !canScrollHorizontally) continue;

    const path = buildScrollStabilizerPath(element, root);
    if (!path) continue;

    states.push({
      path,
      signature: captureScrollStabilizerSignature(element),
      top,
      left
    });
  }

  states.sort((left, right) => left.path.length - right.path.length);
  return states;
}

function restoreScrollStabilizerState(root, states = []) {
  if (!root || !states.length) return;

  for (const state of states) {
    const element = resolveScrollStabilizerElement(root, state);
    if (!element) continue;

    if (typeof state.top === 'number') element.scrollTop = state.top;
    if (typeof state.left === 'number') element.scrollLeft = state.left;
  }
}

// Устанавливает стабилизацию прокрутки листов актёров, оборачивая их _render
function installScrollStabilizer() {
  // Только для системы dnd5e
  if (game.system?.id !== 'dnd5e') return;

  // Обёртка, сохраняющая и восстанавливающая scrollTop для ключевых контейнеров
  const wrapImpl = function(inner) {
    return async function(force, options) {
      try {
        const rootBefore = this?.element?.[0] ?? null;
        const selectors = getScrollStabilizerSelectors(this);
        const saved = collectScrollStabilizerState(rootBefore, selectors);
        const prevSize = { width: this?.position?.width, height: this?.position?.height };

        const result = await inner.call(this, force, options);

        const rootAfter = this?.element?.[0] ?? null;
        if (rootAfter && saved.length) {
          const applyScroll = () => {
            try {
              restoreScrollStabilizerState(rootAfter, saved);
            } catch (_) { /* ignore */ }
          };

          applyScroll();
          globalThis.queueMicrotask?.(applyScroll);
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyScroll);
          setTimeout(applyScroll, 0);
          setTimeout(applyScroll, 50);
          setTimeout(applyScroll, 150);
        }

        try {
          const w = Number(prevSize.width);
          const h = Number(prevSize.height);
          const positionUpdate = {};
          if (Number.isFinite(w) && w > 0) positionUpdate.width = w;
          if (Number.isFinite(h) && h > 0) positionUpdate.height = h;
          if (Object.keys(positionUpdate).length) this.setPosition(positionUpdate);
        } catch (_) { /* ignore */ }

        return result;
      } catch (err) {
        console.warn(`${MODULE_ID} | scroll stabilizer failed`, err);
        return inner.call(this, force, options);
      }
    };
  };

  // Предпочитаем libWrapper, при отсутствии — мягкий монки-патч
  if (globalThis.libWrapper?.register) {
    try {
      libWrapper.register(MODULE_ID, 'ActorSheet.prototype._render', function(wrapper, force, options) {
        const wrapped = wrapImpl(wrapper.bind(this));
        return wrapped.call(this, force, options);
      }, 'MIXED');
      libWrapper.register(MODULE_ID, 'ItemSheet.prototype._render', function(wrapper, force, options) {
        const wrapped = wrapImpl(wrapper.bind(this));
        return wrapped.call(this, force, options);
      }, 'MIXED');
      logDebug('Scroll stabilizer installed via libWrapper');
      return;
    } catch (e) {
      console.warn(`${MODULE_ID} | libWrapper register failed, falling back`, e);
    }
  }

  // Fallback: монки-патчим прототип ActorSheet
  const proto = globalThis.ActorSheet?.prototype;
  if (proto && !proto.__cisScrollWrapped) {
    const original = proto._render;
    proto._render = wrapImpl(original);
    Object.defineProperty(proto, '__cisScrollWrapped', { value: true, enumerable: false, configurable: false });
    logDebug('Scroll stabilizer installed (fallback)');
  }

  // Fallback: ItemSheet
  const iproto = globalThis.ItemSheet?.prototype;
  if (iproto && !iproto.__cisScrollWrapped) {
    const original = iproto._render;
    iproto._render = wrapImpl(original);
    Object.defineProperty(iproto, '__cisScrollWrapped', { value: true, enumerable: false, configurable: false });
  }
}

// Добавляем поле Section в листы предметов
Hooks.on('renderItemSheet', async (app, html, data) => {
  // Проверяем, включен ли модуль и это лист предмета dnd5e
  if (!game.settings.get(MODULE_ID, 'enableCustomSections')) return;
  if (game.system.id !== 'dnd5e') return;

  logDebug(`Adding section field to item ${app.object.name}`);

  // Получаем текущее значение section из флагов
  const section = app.object.getFlag(MODULE_ID, FLAGS.SECTION) || '';
  const nonStackable = Boolean(app.object.getFlag(MODULE_ID, FLAGS.NON_STACKABLE));
  const cellSize = getConfiguredCellInventorySize(app.object);
  
  // Находим вкладку Details
  const detailsTab = html.find('.tab.details');
  
  // Если вкладка Details не найдена, ищем альтернативное место
  const targetElement = detailsTab.length ? detailsTab : html.find('.sheet-body');
  
  // Создаем HTML для поля Section
  const sectionFieldHtml = `
    <div class="form-group">
      <label>${game.i18n.localize('CUSTOM_SECTIONS.Section')}</label>
      <input type="text" name="flags.${MODULE_ID}.${FLAGS.SECTION}" value="${section}" 
             placeholder="${game.i18n.localize('CUSTOM_SECTIONS.SectionPlaceholder')}" />
    </div>
    <div class="form-group">
      <label>${game.i18n.localize('CUSTOM_SECTIONS.CellInventory.Size')}</label>
      <div class="form-fields" style="gap: 0.5rem; align-items: center;">
        <label style="display:flex; align-items:center; gap:0.35rem; margin:0;">
          <span>${game.i18n.localize('CUSTOM_SECTIONS.CellInventory.SizeX')}</span>
          <input
            type="number"
            class="cis-cell-size-input"
            name="flags.${MODULE_ID}.${FLAGS.GRID_SIZE_X}"
            value="${cellSize.width}"
            min="1"
            max="${CELL_INVENTORY.columns}"
            step="1"
            data-dtype="Number"
            style="width: 4.5rem;"
          />
        </label>
        <label style="display:flex; align-items:center; gap:0.35rem; margin:0;">
          <span>${game.i18n.localize('CUSTOM_SECTIONS.CellInventory.SizeY')}</span>
          <input
            type="number"
            class="cis-cell-size-input"
            name="flags.${MODULE_ID}.${FLAGS.GRID_SIZE_Y}"
            value="${cellSize.height}"
            min="1"
            max="${CELL_INVENTORY.rows}"
            step="1"
            data-dtype="Number"
            style="width: 4.5rem;"
          />
        </label>
      </div>
      <p class="notes">${game.i18n.localize('CUSTOM_SECTIONS.CellInventory.SizeHint')}</p>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize('CUSTOM_SECTIONS.NonStackable')}</label>
      <div class="form-fields">
        <input type="checkbox" class="cis-non-stackable" name="flags.${MODULE_ID}.${FLAGS.NON_STACKABLE}" value="true" data-dtype="Boolean" ${nonStackable ? 'checked' : ''} />
      </div>
      <p class="notes">${game.i18n.localize('CUSTOM_SECTIONS.NonStackableHint')}</p>
    </div>
  `;
  
  // Добавляем поле в начало вкладки Details или в конец формы
  if (detailsTab.length) {
    logDebug('Found details tab, adding field after form header');
    // Ищем первый form-header и вставляем после него
    const formHeader = detailsTab.find('.form-header').first();
    if (formHeader.length) {
      formHeader.after(sectionFieldHtml);
    } else {
      detailsTab.prepend(sectionFieldHtml);
    }
  } else {
    logDebug('No details tab found, adding to alternative location');
    // Альтернативное размещение для других типов предметов
    const formGroups = targetElement.find('.form-group');
    if (formGroups.length) {
      formGroups.first().before(sectionFieldHtml);
    } else {
      targetElement.prepend(sectionFieldHtml);
    }
  }

  html.find('.cis-non-stackable').attr('data-edit', false).on('change', async (event) => {
    try {
      await app.object.setFlag(MODULE_ID, FLAGS.NON_STACKABLE, event.currentTarget.checked === true);
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to persist non-stackable flag`, e);
    }
  });
  html.find('.cis-cell-size-input').attr('data-edit', false).on('change', (event) => {
    const input = event.currentTarget;
    const max = input.name.endsWith(FLAGS.GRID_SIZE_X) ? CELL_INVENTORY.columns : CELL_INVENTORY.rows;
    input.value = Math.max(1, Math.min(max, Math.floor(Number(input.value) || 1)));
  });
  
  // Не меняем размеры окна дополнительным вызовом setPosition, чтобы не прыгал скролл

  // Доп. опции контейнера: снижение нагрузки содержимого
  try {
    if (app.object?.type === 'container') {
      const detailsTab = html.find('.tab.details');
      const containerOptionsRoot = detailsTab.length ? detailsTab : html.find('.sheet-body');
      const current = Number(app.object.getFlag(MODULE_ID, FLAGS.WEIGHT_REDUCTION) ?? 0) || 0;
      const containerVolume = getContainerGridSize(app.object);

      const volumeFieldHtml = `
        <div class="form-group cis-container-volume">
          <label>${game.i18n.localize('CUSTOM_SECTIONS.ContainerVolume')}</label>
          <div class="form-fields" style="gap: 0.5rem; align-items: center;">
            <label style="display:flex; align-items:center; gap:0.35rem; margin:0;">
              <span>${game.i18n.localize('CUSTOM_SECTIONS.CellInventory.SizeX')}</span>
              <input
                type="number"
                class="cis-container-volume-input"
                name="flags.${MODULE_ID}.${FLAGS.CONTAINER_GRID_X}"
                value="${containerVolume.width}"
                min="1"
                max="${CELL_INVENTORY.columns}"
                step="1"
                data-dtype="Number"
                style="width: 4.5rem;"
              />
            </label>
            <label style="display:flex; align-items:center; gap:0.35rem; margin:0;">
              <span>${game.i18n.localize('CUSTOM_SECTIONS.CellInventory.SizeY')}</span>
              <input
                type="number"
                class="cis-container-volume-input"
                name="flags.${MODULE_ID}.${FLAGS.CONTAINER_GRID_Y}"
                value="${containerVolume.height}"
                min="1"
                max="${CELL_INVENTORY.rows}"
                step="1"
                data-dtype="Number"
                style="width: 4.5rem;"
              />
            </label>
          </div>
          <p class="notes">${game.i18n.localize('CUSTOM_SECTIONS.ContainerVolumeHint')}</p>
        </div>`;

      const reductionFieldHtml = `
        <div class="form-group">
          <label>${game.i18n.localize('CUSTOM_SECTIONS.ContentWeightReduction')}</label>
          <div class="form-fields" style="gap: 0.5rem; align-items: center;">
            <input type="range" class="cis-wr-slider" min="0" max="100" step="1" value="${current}" aria-label="${game.i18n.localize('CUSTOM_SECTIONS.ContentWeightReduction')}" />
            <input type="number" class="cis-wr-input" name="flags.${MODULE_ID}.${FLAGS.WEIGHT_REDUCTION}" min="0" max="100" step="1" value="${current}" style="width: 5rem;"/>
            <span>%</span>
          </div>
          <p class="notes">${game.i18n.localize('CUSTOM_SECTIONS.ContentWeightReductionHint')}</p>
        </div>`;

      // Вставляем сразу после блока свойств контейнера, если он есть, иначе в конец вкладки
      const afterEl = containerOptionsRoot.find('.container-properties').last();
      if (afterEl.length) afterEl.after(volumeFieldHtml + reductionFieldHtml);
      else containerOptionsRoot.append(volumeFieldHtml + reductionFieldHtml);

      // Синхронизация ползунка и числового ввода
      const $slider = containerOptionsRoot.find('.cis-wr-slider');
      const $input  = containerOptionsRoot.find('.cis-wr-input');
      const $volumeInputs = containerOptionsRoot.find('.cis-container-volume-input');
      $slider.attr('data-edit', false);
      $input.attr('data-edit', false);
      $volumeInputs.attr('data-edit', false);

      const clamp = (n) => Math.max(0, Math.min(100, Math.floor(Number(n) || 0)));
      const clampVolume = (value, axis) => {
        const max = axis === 'x' ? CELL_INVENTORY.columns : CELL_INVENTORY.rows;
        return Math.max(1, Math.min(max, Math.floor(Number(value) || 1)));
      };
      $slider.on('input change', (ev) => {
        const v = clamp(ev.currentTarget.value);
        $input.val(v);
        // Не сохраняем каждое движение ползунка в документ, но при потере фокуса — сохраняем
      });
      $input.on('input', (ev) => {
        const v = clamp(ev.currentTarget.value);
        $input.val(v);
        $slider.val(v);
      }).on('change', async () => {
        try {
          const val = clamp($input.val());
          await app.object.setFlag(MODULE_ID, FLAGS.WEIGHT_REDUCTION, val);
        } catch (_) { /* ignore */ }
      });
      $volumeInputs.on('change', async (ev) => {
        const input = ev.currentTarget;
        const axis = input.name.endsWith(FLAGS.CONTAINER_GRID_X) ? 'x' : 'y';
        const flag = axis === 'x' ? FLAGS.CONTAINER_GRID_X : FLAGS.CONTAINER_GRID_Y;
        const value = clampVolume(input.value, axis);
        input.value = value;
        try {
          await app.object.setFlag(MODULE_ID, flag, value);
        } catch (_) { /* ignore */ }
      });

      // БЛОК: фильтр категорий для содержимого контейнера
      const mode = app.object.getFlag(MODULE_ID, FLAGS.CATEGORY_MODE) || 'allow';
      const list = Array.isArray(app.object.getFlag(MODULE_ID, FLAGS.CATEGORY_LIST))
        ? app.object.getFlag(MODULE_ID, FLAGS.CATEGORY_LIST) : [];

      // Безопасный экранировщик
      const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const renderRow = (value='') => `
        <div class="cis-cat-row" style="display:flex; gap:6px; align-items:center; margin-top:4px;">
          <input type="text" class="cis-cat-input" value="${esc(value)}" placeholder="${game.i18n.localize('CUSTOM_SECTIONS.CategoryName')}"/>
          <a class="cis-cat-add" role="button" aria-label="+"><i class="fas fa-plus"></i></a>
          <a class="cis-cat-del" role="button" aria-label="-"><i class="fas fa-trash"></i></a>
        </div>`;

      const categoryFieldHtml = `
        <div class="form-group stacked cis-category-filter">
          <label>${game.i18n.localize('CUSTOM_SECTIONS.CategoryFilter')}</label>
          <div class="form-fields" style="gap:0.5rem; align-items:center;">
            <select class="cis-cat-mode">
              <option value="allow" ${mode === 'allow' ? 'selected' : ''}>${game.i18n.localize('CUSTOM_SECTIONS.CategoryModeAllow')}</option>
              <option value="deny" ${mode === 'deny' ? 'selected' : ''}>${game.i18n.localize('CUSTOM_SECTIONS.CategoryModeDeny')}</option>
            </select>
          </div>
          <div class="cis-cat-list">
            ${list.length ? list.map(v => renderRow(v)).join('') : renderRow('')}
          </div>
          <p class="notes">${game.i18n.localize('CUSTOM_SECTIONS.CategoryFilterHint')}</p>
        </div>`;

      const afterWR = containerOptionsRoot.find('.cis-wr-input').closest('.form-group');
      if (afterWR.length) afterWR.after(categoryFieldHtml); else containerOptionsRoot.append(categoryFieldHtml);

      // Предотвращаем потерю фокуса при внутр. рендерах: помечаем поле как игнорируемое системой авто-обновления
      containerOptionsRoot.find('.cis-cat-input').attr('data-edit', false);

      const $mode = containerOptionsRoot.find('.cis-cat-mode');
      const $list = containerOptionsRoot.find('.cis-cat-list');

      const readValues = () => $list.find('.cis-cat-input').map((_, el) => String(el.value || '').trim()).get()
        .filter(v => v.length > 0);
      const persist = async () => {
        try {
          await app.object.setFlag(MODULE_ID, FLAGS.CATEGORY_MODE, String($mode.val() || 'allow'));
          await app.object.setFlag(MODULE_ID, FLAGS.CATEGORY_LIST, readValues());
        } catch (e) { /* ignore */ }
      };
      $mode.on('change', persist);
      $list.on('click', '.cis-cat-add', async (ev) => {
        ev.preventDefault();
        const $row = $(renderRow(''));
        $list.append($row);
      });
      $list.on('click', '.cis-cat-del', async (ev) => {
        ev.preventDefault();
        const row = ev.currentTarget.closest('.cis-cat-row');
        if (row) row.remove();
        await persist();
      });
      // Сохраняем только по потере фокуса/изменению, а не при каждом вводе символа
      $list.on('change blur', '.cis-cat-input', async () => { await persist(); });
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | Failed to inject container reduction controls`, e);
  }

  // ЛОКАЛЬНАЯ СТАБИЛИЗАЦИЯ ПРОКРУТКИ ДЛЯ ЛИСТА ПРЕДМЕТА
  try {
    const root = html?.[0];
    if (root) {
      const candidates = [
        root.querySelector('.tab.details'),
        root.querySelector('.sheet-body'),
        root.querySelector('.window-content')
      ].filter(Boolean);
      const scroller = candidates.find(el => (el.scrollHeight - el.clientHeight) > 0) || candidates[0];
      if (scroller) {
        // Восстановить ранее сохранённый скролл
        const key = app.object?.id || app.object?.uuid || app.appId;
        const top = savedItemSheetScroll.get(key);
        if (typeof top === 'number') {
          const apply = () => { try { scroller.scrollTop = top; } catch (_) {} };
          apply();
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
          setTimeout(apply, 0);
          setTimeout(apply, 50);
        }
        // Обновлять сохранённую позицию при прокрутке
        scroller.addEventListener('scroll', () => {
          try { savedItemSheetScroll.set(key, scroller.scrollTop); } catch (_) {}
        }, { passive: true });
      }
    }
  } catch (_) { /* ignore */ }
});

// Подключаемся к хукам рендеринга конкретных листов dnd5e
Hooks.on('renderActorSheet5eCharacter2', (app, html, data) => {
  processCustomSections(app, html, data);
});

Hooks.on('renderActorSheet5eNPC2', (app, html, data) => {
  processCustomSections(app, html, data);
});

Hooks.on('renderActorSheet5eCharacter', (app, html, data) => {
  processCustomSections(app, html, data);
});

Hooks.on('renderActorSheet5eNPC', (app, html, data) => {
  processCustomSections(app, html, data);
});

// Функция определения вкладки для предмета
function getItemTab(item) {
  // Определяем вкладку на основе типа предмета
  switch (item.type) {
    case 'spell':
      return 'spells';
    case 'feat':
    case 'race':
    case 'background':
    case 'class':
    case 'subclass':
      return 'features';
    case 'weapon':
    case 'equipment':
    case 'consumable':
    case 'tool':
    case 'container':
    case 'loot':
    default:
      return 'inventory';
  }
}

// Функция применения tooltip'ов к элементам предметов (аналогично оригинальной системе D&D 5e)
function applyItemTooltips(element, app) {
  if ("tooltip" in element.dataset) return;
  
  const target = element.closest("[data-item-id]");
  if (!target) return;
  
  const itemId = target.dataset.itemId;
  const item = app.actor.items.get(itemId);
  
  if (!item) return;
  
  element.dataset.tooltip = `
    <section class="loading" data-uuid="${item.uuid}"><i class="fas fa-spinner fa-spin-pulse"></i></section>
  `;
  element.dataset.tooltipClass = "dnd5e2 dnd5e-tooltip item-tooltip";
  element.dataset.tooltipDirection ??= "LEFT";
}

// Функция обработки кастомных секций
function processCustomSections(app, html, data) {
  // Проверяем, включен ли модуль
  if (!game.settings.get(MODULE_ID, 'enableCustomSections')) return;
  
  logDebug(`Processing custom sections for actor ${app.actor.name}`);
  logDebug(`Sheet class: ${app.constructor.name}`);
  
  // Добавляем кастомные секции в DOM для каждой вкладки
  addCustomSectionsToDOM(app, html, data);
  
  // Применяем tooltip'ы к элементам в кастомных секциях
  html.find('[data-custom-section] .item-tooltip').each((index, element) => {
    applyItemTooltips(element, app);
  });
  
  // Применяем блокировки редактирования количества для не-GM пользователей
  if (!game.user.isGM) {
    applyQuantityRestrictions(html);
  }

  if (isCellInventoryEnabled()) {
    applyCellInventory(app, html);
  } else {
    // Применяем сетчатый вид к стандартным секциям, если включено в настройках
    applyGridInventory(app, html);

    // Восстанавливаем ранее раскрытые контейнеры
    restoreExpandedContainers(app, html);
  }
}

// Преобразуем стандартные секции dnd5e инвентаря в сетку (без названий), если включено
function applyGridInventory(app, html) {
  if (isCellInventoryEnabled()) return;
  const gridOn = isIconGridInventoryEnabled();
  if (!gridOn) return;

  // Ищем все стандартные секции инвентаря (кроме наших кастомных, у них есть data-custom-section)
  const inventoryTabs = html.find('.tab.inventory');
  if (!inventoryTabs.length) return;

  // Преобразуем список предметов внутри каждой стандартной секции
  inventoryTabs.find('.items-section:not([data-custom-section])').each((_, section) => {
    const $section = $(section);

    // Упростить шапку: оставить только заголовок
    const header = $section.find('.items-header.header');
    header.addClass('cis-grid-header');
    header.children(':not(.item-name)').remove();
    $section.addClass('cis-grid');

    // Список элементов -> сетка
    const list = $section.find('ol.item-list');
    list.addClass('cis-grid-list');

    // Превращаем каждый <li.item> в компактную плитку
    list.children('li.item').each((_, li) => {
      const $li = $(li);
      if ($li.hasClass('cis-grid-item')) return; // уже обработан
      const id = $li.data('itemId');
      const name = $li.data('itemName') ?? '';
      const img = $li.find('img, .item-image').first().attr('src');
      const itemDoc = app.actor.items.get(id);
      const isEquipped = Boolean(itemDoc?.system?.equipped);
      // Количество
      let qty = $li.find('[data-name="system.quantity"]').val();
      qty = Number(qty ?? 0);

      // Собираем новый контент
      const tile = $(`<a class="cis-grid-tile item-action item-tooltip" role="button" data-action="use" aria-label="${name}"></a>`);
      const image = $(`<img class="cis-grid-image" alt="${name}">`).attr('src', img);
      tile.append(image);
      if (qty > 1) tile.append(`<span class="cis-qty">${qty}</span>`);

      // Очистить и применить классы
      $li.attr('class', `item cis-grid-item${isEquipped ? ' equipped' : ''}`);
      $li.empty().append(tile);
      // Назначаем тултип для новой плитки
      applyItemTooltips(tile[0], app);
    });
  });

  // Обработчик клика по плитке в стандартных секциях: контейнеры разворачиваем inline
  inventoryTabs.off('click.cis-grid');
  inventoryTabs.on('click.cis-grid', '.cis-grid-item .cis-grid-tile', async (event) => {
    const li = event.currentTarget.closest('.item');
    if (!li) return;
    const itemId = li.dataset.itemId;
    const item = app.actor.items.get(itemId);
    if (!item) return;
    if (isQuickTransferEvent(event) && getItemTab(item) === 'inventory') {
      event.preventDefault();
      event.stopPropagation();
      await quickTransferItem(app, item);
      return;
    }
    if (event.shiftKey && (item.system?.equipped !== undefined)) {
      event.preventDefault();
      event.stopPropagation();
      await toggleEquip(item, li);
      return;
    }
    if (item.type === 'container') {
      event.preventDefault();
      event.stopPropagation();
      await toggleInlineContainer(app, html, li, item);
      return;
    }
    // Если кликаем внутри нативного элемента инвентаря — делегируем системному обработчику
    const invEl = event.currentTarget.closest('dnd5e-inventory');
    if (invEl && typeof invEl._onAction === 'function') {
      event.preventDefault();
      event.stopPropagation();
      await invEl._onAction(event.currentTarget, 'use');
      return;
    }
    await item.use({}, { event });
  });

  // DnD: делегированные обработчики для стандартных секций (сеточные плитки)
  inventoryTabs.off('pointerdown.cis-grid-tooltip mousedown.cis-grid-tooltip');
  inventoryTabs.on('pointerdown.cis-grid-tooltip mousedown.cis-grid-tooltip', '.cis-grid-item', () => {
    hideActiveTooltip();
  });
  inventoryTabs.off('dragstart.cis-grid dragend.cis-grid dragover.cis-grid drop.cis-grid');
  inventoryTabs.on('dragstart.cis-grid', '.cis-grid-item', (event) => {
    const li = event.currentTarget.closest('.item');
    if (!li) return;
    const itemId = li.dataset.itemId;
    const item = app.actor.items.get(itemId);
    if (!item) return;
    beginOwnedItemSheetDrag(app.actor, item, event);
    li.classList.add('dragging');
  });
  inventoryTabs.on('dragend.cis-grid', '.cis-grid-item', (event) => {
    const li = event.currentTarget.closest('.item');
    finishOwnedItemSheetDrag();
    if (li) li.classList.remove('dragging');
  });
  inventoryTabs.on('dragover.cis-grid', '.cis-grid-item', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.originalEvent?.dataTransfer) event.originalEvent.dataTransfer.dropEffect = 'move';
  });
  inventoryTabs.on('drop.cis-grid', '.cis-grid-item', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const li = event.currentTarget.closest('.item');
    if (!li) return;
    const targetItem = app.actor.items.get(li.dataset.itemId);
    if (!targetItem) return;
    try {
      const dropDataStr = event.originalEvent?.dataTransfer?.getData('text/plain');
      if (!dropDataStr) return;
      const dropData = JSON.parse(dropDataStr);
      const dropped = await resolveDroppedItem(app, dropData);
      if (!dropped) return;
      if (targetItem.type === 'container' && dropped.id !== targetItem.id) {
        await moveItemToContainer(app, dropped, targetItem, dropData);
      } else {
        await moveItemToRoot(app, dropped, dropData);
      }
    } catch (e) {
      console.error(`${MODULE_ID} | drop.cis-grid error`, e);
    }
  });
}

function getCellInventoryRootItems(actor) {
  return actor.items.filter((item) => (
    !item.system?.container
    && getItemTab(item) === 'inventory'
    && !shouldHideItemFromCellInventory(item)
  ));
}

function sanitizeCellInventorySize(value) {
  const width = Math.max(1, Math.min(CELL_INVENTORY.columns, Math.floor(Number(value?.x ?? value?.width ?? 1) || 1)));
  const height = Math.max(1, Math.min(CELL_INVENTORY.rows, Math.floor(Number(value?.y ?? value?.height ?? 1) || 1)));
  return { width, height };
}

function getConfiguredCellInventorySize(itemLike) {
  const readFlag = (flag) => {
    if (typeof itemLike?.getFlag === 'function') return itemLike.getFlag(MODULE_ID, flag);
    return foundry.utils.getProperty(itemLike, `flags.${MODULE_ID}.${flag}`);
  };

  return sanitizeCellInventorySize({
    x: readFlag(FLAGS.GRID_SIZE_X),
    y: readFlag(FLAGS.GRID_SIZE_Y)
  });
}

function getContainerContentsForFootprint(containerItem) {
  if (!containerItem || containerItem.type !== 'container') return [];

  const actor = containerItem.parent;
  if (actor?.items && containerItem.id) {
    return getContainerItems(actor, containerItem.id);
  }

  const rawContents = containerItem.system?.contents;
  if (!rawContents || typeof rawContents?.then === 'function') return [];
  if (typeof rawContents?.values === 'function') return Array.from(rawContents.values());
  if (Array.isArray(rawContents)) return [...rawContents];
  return [];
}

function getCompactContainerFootprintSize(containerItem, baseSize, evaluationStack = new Set()) {
  const contents = getContainerContentsForFootprint(containerItem);
  if (!contents.length) return baseSize;

  const grid = getContainerGridLayout(containerItem);
  const sizedContents = contents
    .map((item) => ({
      item,
      size: getCellInventorySize(item, { _evaluationStack: evaluationStack })
    }))
    .filter(({ size }) => Boolean(size?.width) && Boolean(size?.height))
    .sort((left, right) => {
      const leftArea = left.size.width * left.size.height;
      const rightArea = right.size.width * right.size.height;
      return rightArea - leftArea
        || right.size.height - left.size.height
        || right.size.width - left.size.width
        || compareCellInventoryStrings(left.item?.name, right.item?.name);
    });

  const occupiedCells = new Map();
  let maxRight = 0;
  let maxBottom = 0;

  for (const { item, size } of sizedContents) {
    if (!doesCellInventorySizeFitGrid(size, grid)) {
      return {
        width: Math.max(baseSize.width, grid.columns),
        height: Math.max(baseSize.height, grid.rows)
      };
    }

    const position = findNextFreeCellInventoryPosition(occupiedCells, size, grid);
    if (!position) {
      return {
        width: Math.max(baseSize.width, grid.columns),
        height: Math.max(baseSize.height, grid.rows)
      };
    }

    markCellInventoryArea(occupiedCells, item, position, size, grid);
    maxRight = Math.max(maxRight, position.x + size.width);
    maxBottom = Math.max(maxBottom, position.y + size.height);
  }

  return {
    width: Math.max(baseSize.width, maxRight || 1),
    height: Math.max(baseSize.height, maxBottom || 1)
  };
}

function getCellInventorySize(itemLike, options = {}) {
  const baseSize = getConfiguredCellInventorySize(itemLike);
  if (!itemLike || itemLike.type !== 'container') return baseSize;
  if (options?.useBaseSize) return baseSize;

  const itemKey = itemLike.id ?? itemLike.uuid ?? null;
  const evaluationStack = options?._evaluationStack instanceof Set ? options._evaluationStack : new Set();
  if (itemKey) {
    if (evaluationStack.has(itemKey)) return baseSize;
    evaluationStack.add(itemKey);
  }

  try {
    return getCompactContainerFootprintSize(itemLike, baseSize, evaluationStack);
  } finally {
    if (itemKey) evaluationStack.delete(itemKey);
  }
}

function getContainerGridSize(containerItem) {
  const readFlag = (flag) => {
    if (typeof containerItem?.getFlag === 'function') return containerItem.getFlag(MODULE_ID, flag);
    return foundry.utils.getProperty(containerItem, `flags.${MODULE_ID}.${flag}`);
  };

  return sanitizeCellInventorySize({
    x: readFlag(FLAGS.CONTAINER_GRID_X),
    y: readFlag(FLAGS.CONTAINER_GRID_Y)
  });
}

function createGridDimensions({ width = 1, height = 1 } = {}) {
  return {
    columns: Math.max(1, Math.floor(Number(width) || 1)),
    rows: Math.max(1, Math.floor(Number(height) || 1))
  };
}

function getCellInventoryGridDimensions(size = CELL_INVENTORY) {
  return createGridDimensions({
    width: size?.columns ?? size?.width ?? size?.x ?? CELL_INVENTORY.columns,
    height: size?.rows ?? size?.height ?? size?.y ?? CELL_INVENTORY.rows
  });
}

function getContainerGridLayout(containerItem) {
  const size = getContainerGridSize(containerItem);
  return createGridDimensions(size);
}

function getContainerItems(actor, containerId) {
  if (!actor || !containerId) return [];
  return actor.items.filter((item) => (
    item.system?.container === containerId
    && !shouldHideItemFromCellInventory(item)
  ));
}

function shouldUseContainerCellInventoryGrid(app) {
  try {
    return typeof app?.useCellInventoryContainerGridPanels === 'function'
      ? app.useCellInventoryContainerGridPanels() === true
      : false;
  } catch (_) {
    return false;
  }
}

function shouldToggleCellInventoryContainerOnClick(app) {
  try {
    return typeof app?.shouldToggleCellInventoryContainerOnClick === 'function'
      ? app.shouldToggleCellInventoryContainerOnClick() !== false
      : true;
  } catch (_) {
    return true;
  }
}

function getCellInventoryPanelContainers(app) {
  try {
    if (typeof app?.getCellInventoryPanelContainers === 'function') {
      const customContainers = app.getCellInventoryPanelContainers();
      return Array.isArray(customContainers) ? customContainers.filter(Boolean) : [];
    }
  } catch (_) {
    // Fall back to manual expansion below.
  }

  const expanded = getExpandedContainersForActor(app.actor.id);
  return [...expanded]
    .map((containerId) => app.actor.items.get(containerId))
    .filter(Boolean);
}

function sanitizeCellInventorySortMode(value) {
  switch (String(value ?? '').trim()) {
    case CELL_INVENTORY_SORT_MODES.NAME_ASC:
      return CELL_INVENTORY_SORT_MODES.NAME_ASC;
    case CELL_INVENTORY_SORT_MODES.NAME_DESC:
      return CELL_INVENTORY_SORT_MODES.NAME_DESC;
    case CELL_INVENTORY_SORT_MODES.CATEGORY:
    default:
      return CELL_INVENTORY_SORT_MODES.CATEGORY;
  }
}

function getCellInventorySortMode(actor) {
  return sanitizeCellInventorySortMode(actor?.getFlag?.(MODULE_ID, FLAGS.GRID_SORT_MODE));
}

function getCellInventorySectionName(itemLike) {
  if (typeof itemLike?.getFlag === 'function') {
    return String(itemLike.getFlag(MODULE_ID, FLAGS.SECTION) ?? '').trim();
  }
  return String(foundry.utils.getProperty(itemLike, `flags.${MODULE_ID}.${FLAGS.SECTION}`) ?? '').trim();
}

function compareCellInventoryStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), game.i18n.lang, {
    sensitivity: 'base',
    numeric: true
  });
}

function compareCellInventoryItems(left, right, sortMode = CELL_INVENTORY_SORT_MODES.CATEGORY) {
  const normalizedMode = sanitizeCellInventorySortMode(sortMode);
  const leftSection = getCellInventorySectionName(left);
  const rightSection = getCellInventorySectionName(right);
  const leftName = String(left?.name ?? '');
  const rightName = String(right?.name ?? '');

  if (normalizedMode === CELL_INVENTORY_SORT_MODES.CATEGORY) {
    const emptyDiff = Number(!leftSection) - Number(!rightSection);
    if (emptyDiff) return emptyDiff;

    const sectionDiff = compareCellInventoryStrings(leftSection, rightSection);
    if (sectionDiff) return sectionDiff;

    const nameDiff = compareCellInventoryStrings(leftName, rightName);
    if (nameDiff) return nameDiff;
  } else {
    const nameDiff = compareCellInventoryStrings(leftName, rightName);
    if (nameDiff) {
      return normalizedMode === CELL_INVENTORY_SORT_MODES.NAME_DESC ? -nameDiff : nameDiff;
    }

    const sectionDiff = compareCellInventoryStrings(leftSection, rightSection);
    if (sectionDiff) return sectionDiff;
  }

  const leftSize = getCellInventorySize(left);
  const rightSize = getCellInventorySize(right);
  const areaDiff = (rightSize.width * rightSize.height) - (leftSize.width * leftSize.height);
  if (areaDiff) return areaDiff;

  return ((left?.sort ?? 0) - (right?.sort ?? 0))
    || compareCellInventoryStrings(left?.id, right?.id);
}

function isCellInventoryPositionWithinBounds(position, size = { width: 1, height: 1 }, gridDimensions = CELL_INVENTORY) {
  const grid = getCellInventoryGridDimensions(gridDimensions);
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0) return false;
  if ((x + size.width) > grid.columns) return false;
  if ((y + size.height) > grid.rows) return false;
  return true;
}

function sanitizeCellInventoryPosition(value, size = { width: 1, height: 1 }, gridDimensions = CELL_INVENTORY) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  const position = { x, y };
  return isCellInventoryPositionWithinBounds(position, size, gridDimensions) ? position : null;
}

function getCellInventoryPositionKey(position) {
  return `${position.x},${position.y}`;
}

function getCellInventoryAreaPositions(position, size, { clamp = false, gridDimensions = CELL_INVENTORY } = {}) {
  const grid = getCellInventoryGridDimensions(gridDimensions);
  const positions = [];
  const width = Number(size?.width ?? 1);
  const height = Number(size?.height ?? 1);

  for (let y = position.y; y < position.y + height; y += 1) {
    for (let x = position.x; x < position.x + width; x += 1) {
      if (clamp && ((x < 0) || (y < 0) || (x >= grid.columns) || (y >= grid.rows))) continue;
      positions.push({ x, y });
    }
  }

  return positions;
}

function markCellInventoryArea(occupiedCells, item, position, size, gridDimensions = CELL_INVENTORY) {
  for (const cell of getCellInventoryAreaPositions(position, size, { gridDimensions })) {
    occupiedCells.set(getCellInventoryPositionKey(cell), item);
  }
}

function getConflictingCellInventoryItems(occupiedCells, position, size, ignoredIds = new Set(), gridDimensions = CELL_INVENTORY) {
  const conflicts = new Map();

  for (const cell of getCellInventoryAreaPositions(position, size, { clamp: true, gridDimensions })) {
    const item = occupiedCells.get(getCellInventoryPositionKey(cell));
    if (!item || ignoredIds.has(item.id)) continue;
    conflicts.set(item.id, item);
  }

  return [...conflicts.values()];
}

function warnCellInventoryDoesNotFit() {
  ui.notifications?.warn?.(localizeSafe(
    'CUSTOM_SECTIONS.CellInventory.DoesNotFit',
    'Item does not fit in the selected cells.'
  ));
}

function getCellInventoryDragAnchorOffset(size = { width: 1, height: 1 }) {
  return {
    x: Math.max(0, Math.floor(Number(size?.width ?? 1) / 2)),
    y: Math.max(0, Math.floor(Number(size?.height ?? 1) / 2))
  };
}

function getCellInventoryGridPositionFromEvent(gridElement, event, gridDimensions = CELL_INVENTORY, size = { width: 1, height: 1 }) {
  const doc = gridElement?.ownerDocument ?? document;
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);
  const dragSize = sanitizeCellInventorySize(size);
  const anchorOffset = getCellInventoryDragAnchorOffset(dragSize);

  if (Number.isFinite(clientX) && Number.isFinite(clientY) && typeof doc.elementsFromPoint === 'function') {
    const elements = doc.elementsFromPoint(clientX, clientY);
    const cell = elements.find(element => element?.classList?.contains?.('cis-cell-inventory-cell'));
    if (cell) {
      return sanitizeCellInventoryPosition({
        x: Number(cell.dataset.gridX) - anchorOffset.x,
        y: Number(cell.dataset.gridY) - anchorOffset.y
      }, dragSize, gridDimensions);
    }
  }

  const rect = gridElement.getBoundingClientRect();
  const sampleCell = gridElement.querySelector('.cis-cell-inventory-cell');
  const cellRect = sampleCell?.getBoundingClientRect?.();
  const cellWidth = Math.max(1, Math.round(Number(cellRect?.width) || CELL_INVENTORY.cellSize));
  const cellHeight = Math.max(1, Math.round(Number(cellRect?.height) || CELL_INVENTORY.cellSize));
  const x = Math.floor((clientX - rect.left) / cellWidth) - anchorOffset.x;
  const y = Math.floor((clientY - rect.top) / cellHeight) - anchorOffset.y;
  return sanitizeCellInventoryPosition({ x, y }, dragSize, gridDimensions);
}

function setCellInventoryDragTarget(root, position, size, isValid = true, scopeRoot = root) {
  root.find('.cis-cell-inventory-cell').removeClass('drag-over drag-invalid');
  root.find('.cis-cell-inventory-drag-preview').removeClass('active invalid').attr('style', '');
  if (!position) return;

  const scope = scopeRoot instanceof jQuery ? scopeRoot : $(scopeRoot);

  const className = isValid ? 'drag-over' : 'drag-invalid';
  for (const cell of getCellInventoryAreaPositions(position, size, { clamp: true })) {
    scope.find(`.cis-cell-inventory-cell[data-grid-x="${cell.x}"][data-grid-y="${cell.y}"]`).addClass(className);
  }

  const preview = scope.find('.cis-cell-inventory-drag-preview').first();
  if (preview.length) {
    preview
      .addClass(`active${isValid ? '' : ' invalid'}`)
      .attr('style', `grid-column: ${position.x + 1} / span ${size.width}; grid-row: ${position.y + 1} / span ${size.height};`);
  }
}

function getStoredCellInventoryPosition(item, actorId = null, gridDimensions = CELL_INVENTORY) {
  const size = getCellInventorySize(item);
  const position = item.getFlag?.(MODULE_ID, FLAGS.GRID_POSITION);
  const storedPosition = sanitizeCellInventoryPosition(position, size, gridDimensions);
  if (storedPosition) return storedPosition;

  const cachedPosition = getCellInventoryPositionCache(actorId)?.get(item.id);
  return sanitizeCellInventoryPosition(cachedPosition, size, gridDimensions);
}

function findNextFreeCellInventoryPosition(occupiedCells, size = { width: 1, height: 1 }, gridDimensions = CELL_INVENTORY) {
  const grid = getCellInventoryGridDimensions(gridDimensions);
  const maxY = grid.rows - size.height;
  const maxX = grid.columns - size.width;

  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x <= maxX; x += 1) {
      const position = { x, y };
      if (getConflictingCellInventoryItems(occupiedCells, position, size, new Set(), grid).length === 0) return position;
    }
  }
  return null;
}

function buildCellInventoryLayout(items, {
  sortMode = CELL_INVENTORY_SORT_MODES.CATEGORY,
  actorId = null,
  gridDimensions = CELL_INVENTORY
} = {}) {
  const grid = getCellInventoryGridDimensions(gridDimensions);
  const sortedItems = [...items].sort((left, right) => {
    const leftPosition = getStoredCellInventoryPosition(left, actorId, grid);
    const rightPosition = getStoredCellInventoryPosition(right, actorId, grid);
    if (leftPosition && rightPosition) {
      return (leftPosition.y - rightPosition.y)
        || (leftPosition.x - rightPosition.x)
        || compareCellInventoryItems(left, right, sortMode);
    }
    if (leftPosition) return -1;
    if (rightPosition) return 1;
    return compareCellInventoryItems(left, right, sortMode);
  });

  const placements = new Map();
  const occupiedCells = new Map();
  const pendingItems = [];
  const overflow = [];

  for (const item of sortedItems) {
    const size = getCellInventorySize(item);
    const position = getStoredCellInventoryPosition(item, actorId, grid);
    if (!position) {
      pendingItems.push(item);
      continue;
    }
    if (getConflictingCellInventoryItems(occupiedCells, position, size, new Set(), grid).length) {
      pendingItems.push(item);
      continue;
    }
    placements.set(item.id, { position, size });
    markCellInventoryArea(occupiedCells, item, position, size, grid);
  }

  pendingItems.sort((left, right) => compareCellInventoryItems(left, right, sortMode));

  for (const item of pendingItems) {
    const size = getCellInventorySize(item);
    const position = findNextFreeCellInventoryPosition(occupiedCells, size, grid);
    if (!position) {
      overflow.push(item);
      continue;
    }
    placements.set(item.id, { position, size });
    markCellInventoryArea(occupiedCells, item, position, size, grid);
  }

  return { placements, occupiedCells, overflow };
}

function collectCellInventoryLayoutState(actor) {
  const items = getCellInventoryRootItems(actor);
  const sortMode = getCellInventorySortMode(actor);
  const { placements, occupiedCells, overflow } = buildCellInventoryLayout(items, {
    sortMode,
    actorId: actor?.id ?? null,
    gridDimensions: CELL_INVENTORY
  });
  const positionCache = new Map();
  for (const item of items) {
    const placement = placements.get(item.id);
    if (!placement?.position) continue;
    positionCache.set(item.id, foundry.utils.deepClone(placement.position));
  }
  if (actor?.id) cellInventoryPositionCacheByActor.set(actor.id, positionCache);
  return {
    items,
    placements,
    occupiedCells,
    overflow,
    sortMode,
    gridDimensions: getCellInventoryGridDimensions(CELL_INVENTORY)
  };
}

function collectContainerInventoryLayoutState(actor, containerItem) {
  const items = getContainerItems(actor, containerItem?.id);
  const sortMode = getCellInventorySortMode(actor);
  const gridDimensions = getContainerGridLayout(containerItem);
  const { placements, occupiedCells, overflow } = buildCellInventoryLayout(items, {
    sortMode,
    actorId: actor?.id ?? null,
    gridDimensions
  });

  return {
    items,
    placements,
    occupiedCells,
    overflow,
    sortMode,
    gridDimensions,
    containerId: containerItem?.id ?? null
  };
}

function getCellInventoryScopeLayoutState(app, containerId = null) {
  if (!containerId) return collectCellInventoryLayoutState(app.actor);
  const containerItem = app.actor.items.get(containerId);
  if (!containerItem) return null;
  return collectContainerInventoryLayoutState(app.actor, containerItem);
}

function getCellInventoryPlacementState(layoutState, position, size, ignoredIds = new Set(), gridDimensions = null) {
  const grid = getCellInventoryGridDimensions(gridDimensions ?? layoutState?.gridDimensions ?? CELL_INVENTORY);
  const normalized = sanitizeCellInventoryPosition(position, size, grid);
  if (!normalized) {
    return {
      position: null,
      conflicts: [],
      isValid: false
    };
  }

  const ignored = ignoredIds instanceof Set ? ignoredIds : new Set(ignoredIds ? [ignoredIds].flat() : []);
  const conflicts = getConflictingCellInventoryItems(layoutState?.occupiedCells ?? new Map(), normalized, size, ignored, grid);
  return {
    position: normalized,
    conflicts,
    isValid: conflicts.length === 0
  };
}

function getCellInventoryDragState(app, nativeEvent, { readDropData = false } = {}) {
  const shouldReadDropData = readDropData || !activeCellInventoryDrag;
  const dropData = shouldReadDropData ? getDragEventData(nativeEvent) : null;
  const ignoredIds = new Set();
  let dragSize = activeCellInventoryDrag?.size ?? { width: 1, height: 1 };

  if (activeCellInventoryDrag?.actorId === app.actor.id && activeCellInventoryDrag.itemId) {
    ignoredIds.add(activeCellInventoryDrag.itemId);
  } else if (dropData?.type === 'Item' && dropData.actorId === app.actor.id) {
    const actorItem = app.actor.items.get(dropData.id);
    if (actorItem) {
      dragSize = getCellInventorySize(actorItem);
      ignoredIds.add(actorItem.id);
    }
  }

  return { dropData, dragSize, ignoredIds };
}

function getCellInventoryToolbarMeta(app) {
  try {
    if (typeof app?.getCellInventoryToolbarMeta !== 'function') return null;
    const meta = app.getCellInventoryToolbarMeta();
    if (!meta || (!meta.label && !meta.value)) return null;
    return {
      label: escapeHtml(String(meta.label || '')),
      value: escapeHtml(String(meta.value || ''))
    };
  } catch (_) {
    return null;
  }
}

function createCellInventorySortControls(sortMode, toolbarMeta = null) {
  const normalizedMode = sanitizeCellInventorySortMode(sortMode);
  const sortLabel = escapeHtml(localizeSafe('CUSTOM_SECTIONS.CellInventory.Sort.Label', 'Сортировка'));
  const options = [
    {
      mode: CELL_INVENTORY_SORT_MODES.CATEGORY,
      label: localizeSafe('CUSTOM_SECTIONS.CellInventory.Sort.Category', 'По категориям')
    },
    {
      mode: CELL_INVENTORY_SORT_MODES.NAME_ASC,
      label: localizeSafe('CUSTOM_SECTIONS.CellInventory.Sort.NameAsc', 'А-Я')
    },
    {
      mode: CELL_INVENTORY_SORT_MODES.NAME_DESC,
      label: localizeSafe('CUSTOM_SECTIONS.CellInventory.Sort.NameDesc', 'Я-А')
    }
  ];

  return `
    <div class="cis-cell-inventory-toolbar">
      <details class="cis-cell-inventory-sort-menu">
        <summary class="cis-cell-inventory-sort-button" title="${sortLabel}" aria-label="${sortLabel}">
          <i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i>
        </summary>
        <div class="cis-cell-inventory-sort-dropdown">
          ${options.map(option => `
            <button
              type="button"
              class="cis-cell-inventory-sort-option${option.mode === normalizedMode ? ' active' : ''}"
              data-sort-mode="${option.mode}"
            >${escapeHtml(option.label)}</button>
          `).join('')}
        </div>
      </details>
      ${toolbarMeta ? `
        <div class="cis-cell-inventory-meta">
          <span class="cis-cell-inventory-label">${toolbarMeta.label}</span>
          <span class="cis-cell-inventory-value">${toolbarMeta.value}</span>
        </div>
      ` : ''}
    </div>
  `;
}

async function applyCellInventorySortMode(app, mode) {
  const sortMode = sanitizeCellInventorySortMode(mode);
  const rootItems = getCellInventoryRootItems(app.actor);
  clearCellInventoryPositionCache(app.actor.id);
  await app.actor.setFlag(MODULE_ID, FLAGS.GRID_SORT_MODE, sortMode);
  if (!rootItems.length) return;

  await app.actor.updateEmbeddedDocuments('Item', rootItems.map(item => ({
    _id: item.id,
    [`flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`]: null
  })));
}

function createCellInventoryItemHtml(item, placement) {
  const name = escapeHtml(item.name);
  const image = escapeHtml(item.img || '');
  const quantity = Number(item.system?.quantity ?? 1);
  const quantityLabel = escapeHtml(localizeSafe('DND5E.Quantity', 'Quantity'));
  const equippedClass = item.system?.equipped ? ' equipped' : '';
  const { position, size } = placement;
  const containerMarker = item.type === 'container'
    ? `<span class="cis-cell-inventory-marker" aria-hidden="true"><i class="fa-solid fa-box-open"></i></span>`
    : '';

  return `
    <div class="cis-cell-inventory-item${equippedClass}" draggable="true"
         data-item-id="${item.id}" data-entry-id="${item.id}" data-item-name="${name}"
         data-item-sort="${item.sort || 0}" data-item-type="${item.type}"
         data-grid-x="${position.x}" data-grid-y="${position.y}"
         data-size-x="${size.width}" data-size-y="${size.height}"
         style="grid-column: ${position.x + 1} / span ${size.width}; grid-row: ${position.y + 1} / span ${size.height}; --cis-item-span-x: ${size.width}; --cis-item-span-y: ${size.height};">
      <a class="cis-cell-inventory-tile item-action item-tooltip" role="button" data-action="use" aria-label="${name}">
        ${containerMarker}
        <img class="cis-cell-inventory-image" src="${image}" alt="${name}">
        <span class="cis-cell-inventory-name">${name}</span>
        ${quantity > 1 ? `<span class="cis-qty" aria-label="${quantityLabel}">${quantity}</span>` : ''}
      </a>
    </div>
  `;
}

function createCellInventoryGridMarkup(layoutState, { containerId = '' } = {}) {
  const {
    items,
    placements,
    occupiedCells,
    gridDimensions
  } = layoutState;
  const grid = getCellInventoryGridDimensions(gridDimensions);
  const gridStyle = `grid-template-columns: repeat(${grid.columns}, var(--cis-cell-size, 100px)); grid-template-rows: repeat(${grid.rows}, var(--cis-cell-size, 100px));`;
  const cells = [];
  const renderedItems = [];

  for (let y = 0; y < grid.rows; y += 1) {
    for (let x = 0; x < grid.columns; x += 1) {
      const position = { x, y };
      const key = getCellInventoryPositionKey(position);
      const item = occupiedCells.get(key);
      cells.push(`
        <div
          class="cis-cell-inventory-cell${item ? ' occupied' : ''}"
          data-grid-x="${x}"
          data-grid-y="${y}"
          style="grid-column: ${x + 1}; grid-row: ${y + 1};"
        ></div>
      `);
    }
  }

  for (const item of items) {
    const placement = placements.get(item.id);
    if (!placement) continue;
    renderedItems.push(createCellInventoryItemHtml(item, placement));
  }

  return `
    <div class="cis-cell-inventory-grid-stack" data-container-id="${escapeHtml(containerId)}">
      <div class="cis-cell-inventory-grid cis-cell-inventory-cells" style="${gridStyle}">
        ${cells.join('')}
      </div>
      <div class="cis-cell-inventory-grid cis-cell-inventory-items" style="${gridStyle}">
        ${renderedItems.join('')}
        <div class="cis-cell-inventory-drag-preview" aria-hidden="true"></div>
      </div>
    </div>
  `;
}

function createCellInventoryHtml(app, layoutState = null) {
  const {
    overflow,
    sortMode
  } = layoutState ?? collectCellInventoryLayoutState(app.actor);
  const toolbarMeta = getCellInventoryToolbarMeta(app);
  const overflowHtml = overflow.length
    ? `<div class="cis-cell-inventory-overflow">${escapeHtml(formatLocalizeSafe(
        'CUSTOM_SECTIONS.CellInventory.Overflow',
        { count: overflow.length },
        `Overflow: ${overflow.length}`
      ))}</div>`
    : '';

  return `
    <div class="cis-cell-inventory-shell">
      ${createCellInventorySortControls(sortMode, toolbarMeta)}
      <div class="cis-cell-inventory-scroll">
        <div class="cis-cell-inventory-content">
          <div class="cis-cell-inventory-scope cis-cell-inventory-root-scope" data-scope-type="root">
            ${createCellInventoryGridMarkup(layoutState ?? collectCellInventoryLayoutState(app.actor))}
          </div>
          ${overflowHtml}
          <div class="cis-cell-inventory-panels"></div>
        </div>
      </div>
    </div>
  `;
}

function clearCellInventoryDragState(root) {
  root.find('.cis-cell-inventory-item').removeClass('dragging');
  root.find('.cis-cell-inventory-cell').removeClass('drag-over drag-invalid');
  root.find('.cis-cell-inventory-drag-preview').removeClass('active invalid').attr('style', '');
}

async function renderCellInventoryPanels(app, root) {
  const panelHost = root.find('.cis-cell-inventory-panels');
  if (!panelHost.length) return;
  panelHost.empty();

  const hasCustomContainerList = typeof app?.getCellInventoryPanelContainers === 'function';
  const expanded = getExpandedContainersForActor(app.actor.id);
  const containerItems = getCellInventoryPanelContainers(app);
  if (!containerItems.length) return;

  for (const containerItem of containerItems) {
    if (!containerItem || containerItem.type !== 'container' || containerItem.system?.container || getItemTab(containerItem) !== 'inventory') {
      if (!hasCustomContainerList && containerItem?.id) expanded.delete(containerItem.id);
      continue;
    }
    const panel = shouldUseContainerCellInventoryGrid(app)
      ? await buildContainerCellInventoryPanel(app, containerItem)
      : await buildContainerContentsPanel(app, containerItem);
    panel.addClass('cis-cell-inventory-panel');
    panelHost.append(panel);
  }
}

function getDragEventData(event) {
  try {
    if (typeof TextEditor?.getDragEventData === 'function') return TextEditor.getDragEventData(event);
  } catch (_) { /* ignore */ }
  try {
    const raw = event?.dataTransfer?.getData('text/plain');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function moveRootInventoryItemToCell(app, item, position) {
  const size = getCellInventorySize(item);
  const normalized = sanitizeCellInventoryPosition(position, size);
  if (!normalized) {
    warnCellInventoryDoesNotFit();
    return false;
  }

  const rootItems = getCellInventoryRootItems(app.actor);
  if (!rootItems.some(rootItem => rootItem.id === item.id)) return false;

  const storedPosition = getStoredCellInventoryPosition(item, app.actor.id);
  if (storedPosition && getCellInventoryPositionKey(storedPosition) === getCellInventoryPositionKey(normalized)) return true;

  const layoutState = collectCellInventoryLayoutState(app.actor);
  const placementState = getCellInventoryPlacementState(layoutState, normalized, size, new Set([item.id]));
  if (!placementState.isValid) {
    warnCellInventoryDoesNotFit();
    return false;
  }

  await app.actor.updateEmbeddedDocuments('Item', [{
    _id: item.id,
    [`flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`]: placementState.position,
    'system.container': null
  }]);
  return true;
}

async function createExternalItemAtCell(app, dropData, position, event) {
  try {
    const sourceItem = await Item.implementation.fromDropData(dropData);
    if (!sourceItem) return false;

    let itemData = sourceItem.toObject ? sourceItem.toObject() : foundry.utils.duplicate(sourceItem);
    if (!itemData) return false;
    itemData.system = itemData.system ?? {};

    const qty = Number(itemData.system.quantity ?? 1);
    let amount = qty;
    if (qty > 1) amount = await promptForQuantity({ title: sourceItem.name ?? itemData.name ?? '', max: qty });
    if (!amount || amount < 1) return false;

    itemData.system.quantity = amount;
    foundry.utils.setProperty(itemData, 'system.container', null);

    if (typeof app._onDropSingleItem === 'function') {
      const previousEvent = app._event;
      app._event = event ?? previousEvent;
      try {
        const prepared = await app._onDropSingleItem(itemData);
        if (prepared === false) {
          const mergeTarget = findMergeTarget(app.actor, itemData, null);
          if (mergeTarget) await moveRootInventoryItemToCell(app, mergeTarget, position);
          return true;
        }
        itemData = prepared ?? itemData;
      } finally {
        app._event = previousEvent;
      }
    }

    itemData.system = itemData.system ?? {};
    itemData.system.quantity = Number(itemData.system.quantity ?? amount) || amount;
    foundry.utils.setProperty(itemData, 'system.container', null);

    const mergeTarget = findMergeTarget(app.actor, itemData, null);
    const itemSize = getCellInventorySize(itemData);
    const layoutState = collectCellInventoryLayoutState(app.actor);
    const placementState = getCellInventoryPlacementState(
      layoutState,
      position,
      itemSize,
      mergeTarget ? new Set([mergeTarget.id]) : new Set()
    );
    if (!placementState.isValid) {
      warnCellInventoryDoesNotFit();
      return false;
    }

    if (mergeTarget) {
      await mergeTarget.update({
        'system.quantity': Number(mergeTarget.system.quantity ?? 0) + Number(itemData.system.quantity ?? amount)
      });
      await moveRootInventoryItemToCell(app, mergeTarget, placementState.position);
      return true;
    }

    const ItemDocument = CONFIG.Item?.documentClass ?? globalThis.dnd5e?.documents?.Item5e;
    let createdItems;
    if (typeof ItemDocument?.createWithContents === 'function' && typeof ItemDocument?.createDocuments === 'function') {
      const toCreate = await ItemDocument.createWithContents([sourceItem], {
        transformFirst: () => itemData
      });
      createdItems = await ItemDocument.createDocuments(toCreate, {
        pack: app.actor.pack,
        parent: app.actor,
        keepId: true
      });
    } else {
      createdItems = await app.actor.createEmbeddedDocuments('Item', [itemData]);
    }

    const createdRootItem = createdItems.find(item => item.id === (itemData._id ?? sourceItem.id))
      ?? createdItems.find(item => !item.system?.container)
      ?? createdItems[0];
    if (!createdRootItem) return false;

    await moveRootInventoryItemToCell(app, createdRootItem, placementState.position);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to create external item in cell inventory`, error);
    return false;
  }
}

function getCellInventoryGridScopeContext(app, gridElement) {
  const scopeElement = gridElement?.closest?.('.cis-cell-inventory-scope') ?? null;
  const containerId = scopeElement?.dataset?.containerId || gridElement?.dataset?.containerId || null;
  const layoutState = getCellInventoryScopeLayoutState(app, containerId);
  return {
    containerId,
    layoutState,
    scopeRoot: scopeElement ? $(scopeElement) : $(gridElement)
  };
}

function applyCellInventory(app, html) {
  const inventoryTab = html.find('.tab.inventory');
  if (!inventoryTab.length) return;

  const host = inventoryTab.find('.items-list.inventory-list').first();
  if (!host.length) return;

  inventoryTab.addClass('cis-cell-inventory-mode');
  inventoryTab.find('item-list-controls').addClass('cis-cell-inventory-hidden-controls');

  host.addClass('cis-cell-inventory-host');
  const layoutState = collectCellInventoryLayoutState(app.actor);
  host.empty().append(createCellInventoryHtml(app, layoutState));

  host.find('.item-tooltip').each((_, element) => {
    applyItemTooltips(element, app);
  });
  renderCellInventoryPanels(app, host).catch(error => {
    console.error(`${MODULE_ID} | Failed to render cell inventory panels`, error);
  });

  host.off('.cis-cell-inventory');

  host.on('click.cis-cell-inventory', '.cis-cell-inventory-sort-option', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const sortMode = event.currentTarget.dataset.sortMode;
    const menu = event.currentTarget.closest('.cis-cell-inventory-sort-menu');
    if (menu) menu.open = false;
    await applyCellInventorySortMode(app, sortMode);
  });

  host.on('click.cis-cell-inventory', '.cis-cell-inventory-item .cis-cell-inventory-tile', async (event) => {
    const itemElement = event.currentTarget.closest('.cis-cell-inventory-item');
    if (!itemElement) return;
    const item = app.actor.items.get(itemElement.dataset.itemId);
    if (!item) return;

    if (isQuickTransferEvent(event) && getItemTab(item) === 'inventory') {
      event.preventDefault();
      event.stopPropagation();
      await quickTransferItem(app, item);
      return;
    }

    if (event.shiftKey && (item.system?.equipped !== undefined)) {
      event.preventDefault();
      event.stopPropagation();
      await toggleEquip(item, itemElement, { app, html });
      return;
    }

    if (item.type === 'container') {
      event.preventDefault();
      event.stopPropagation();
      if (shouldToggleCellInventoryContainerOnClick(app)) {
        const expanded = getExpandedContainersForActor(app.actor.id);
        if (expanded.has(item.id)) expanded.delete(item.id);
        else expanded.add(item.id);
        applyCellInventory(app, html);
      }
      return;
    }

    const invEl = event.currentTarget.closest('dnd5e-inventory');
    if (invEl && typeof invEl._onAction === 'function') {
      event.preventDefault();
      event.stopPropagation();
      await invEl._onAction(event.currentTarget, 'use');
      return;
    }

    await item.use({}, { event });
  });

  host.on('dragstart.cis-cell-inventory', '.cis-cell-inventory-item', (event) => {
    const itemElement = event.currentTarget.closest('.cis-cell-inventory-item');
    if (!itemElement) return;
    const item = app.actor.items.get(itemElement.dataset.itemId);
    if (!item) return;
    beginOwnedItemSheetDrag(app.actor, item, event);
    itemElement.classList.add('dragging');
  });

  host.on('dragend.cis-cell-inventory', '.cis-cell-inventory-item', () => {
    clearCellInventoryDragState(host);
    finishOwnedItemSheetDrag();
  });

  host.on('dragover.cis-cell-inventory', '.cis-cell-inventory-grid-stack', (event) => {
    event.preventDefault();
    const nativeEvent = event.originalEvent ?? event;
    const scopeContext = getCellInventoryGridScopeContext(app, event.currentTarget);
    if (!scopeContext.layoutState) return;
    const { dragSize, ignoredIds } = getCellInventoryDragState(app, nativeEvent);
    const targetPosition = getCellInventoryGridPositionFromEvent(
      event.currentTarget,
      nativeEvent,
      scopeContext.layoutState.gridDimensions,
      dragSize
    );
    const placementState = getCellInventoryPlacementState(scopeContext.layoutState, targetPosition, dragSize, ignoredIds);
    const isValid = placementState.isValid;
    if (nativeEvent.dataTransfer) nativeEvent.dataTransfer.dropEffect = isValid ? 'move' : 'none';
    setCellInventoryDragTarget(host, placementState.position, dragSize, isValid, scopeContext.scopeRoot);
  });

  host.on('dragleave.cis-cell-inventory', '.cis-cell-inventory-grid-stack', (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    clearCellInventoryDragState(host);
  });

  host.on('drop.cis-cell-inventory', '.cis-cell-inventory-grid-stack', async (event) => {
    const nativeEvent = event.originalEvent ?? event;
    event.stopImmediatePropagation();
    nativeEvent.stopImmediatePropagation?.();
    const { dropData, dragSize } = getCellInventoryDragState(app, nativeEvent, { readDropData: true });
    clearCellInventoryDragState(host);
    finishOwnedItemSheetDrag();
    if (!dropData) return;

    event.preventDefault();
    nativeEvent.preventDefault?.();

    const scopeContext = getCellInventoryGridScopeContext(app, event.currentTarget);
    if (!scopeContext.layoutState) return;
    const targetPosition = getCellInventoryGridPositionFromEvent(
      event.currentTarget,
      nativeEvent,
      scopeContext.layoutState.gridDimensions,
      dragSize
    );
    if (!targetPosition) return;

    const targetContainer = scopeContext.containerId ? app.actor.items.get(scopeContext.containerId) ?? null : null;
    const droppedItem = await resolveDroppedItem(app, dropData);
    const sameActorItem = (dropData.type === 'Item') && (droppedItem?.parent === app.actor);
    if (!sameActorItem) {
      event.preventDefault();
      event.stopPropagation();
      if (dropData.type !== 'Item') {
        if (!targetContainer && typeof app._onDrop === 'function') {
          await app._onDrop(nativeEvent);
        }
        return;
      }
      if (targetContainer) {
        if (!droppedItem) return;
        await moveItemToContainer(app, droppedItem, targetContainer, { dropData, position: targetPosition });
        return;
      }
      await createExternalItemAtCell(app, dropData, targetPosition, nativeEvent);
      return;
    }

    event.stopPropagation();

    if (!droppedItem) return;
    let localItem = droppedItem;
    if (getItemTab(localItem) !== 'inventory') return;
    if (targetContainer) {
      if (targetContainer.id === localItem.id) return;
      await moveItemToContainer(app, localItem, targetContainer, { dropData, position: targetPosition });
      return;
    }
    const placementState = getCellInventoryPlacementState(
      scopeContext.layoutState,
      targetPosition,
      getCellInventorySize(localItem),
      new Set([localItem.id])
    );
    if (!placementState.isValid) {
      warnCellInventoryDoesNotFit();
      return;
    }

    if (isPaperDollSourceDropData(dropData) || isPaperDollInventoryHidden(localItem)) {
      await movePaperDollDraggedItemToCell(app, localItem, placementState.position, dropData);
      return;
    }

    if (localItem.system?.container) {
      const droppedId = localItem.id;
      await moveItemToRoot(app, localItem, dropData);
      const movedItem = app.actor.items.get(droppedId);
      if (movedItem && !movedItem.system?.container) {
        await moveRootInventoryItemToCell(app, movedItem, placementState.position);
      }
      return;
    }

    await moveRootInventoryItemToCell(app, localItem, placementState.position);
  });
}

// Функция применения ограничений на редактирование количества
function applyQuantityRestrictions(html) {
  // Блокируем поля ввода количества в кастомных секциях
  html.find('[data-custom-section] input[data-name="system.quantity"]').each(function() {
    const input = $(this);
    // Сохраняем исходное значение, если еще не сохранено
    if (!input.attr('data-prev-value')) {
      input.attr('data-prev-value', input.val());
    }
    // Делаем поле только для чтения
    input.prop('readonly', true);
    input.attr('title', 'Только GM может изменять количество предметов');
  });
  
  // Блокируем кнопки увеличения/уменьшения количества в кастомных секциях
  html.find('[data-custom-section] .adjustment-button').each(function() {
    const button = $(this);
    button.attr({
      'disabled': 'disabled',
      'title': 'Только GM может изменять количество предметов'
    });
  });
}

// Функция добавления кастомных секций в DOM
function addCustomSectionsToDOM(app, html, data) {
  // Группируем предметы по вкладкам и кастомным секциям
  const tabSections = {
    inventory: new Map(),
    features: new Map(),
    spells: new Map()
  };
  
  // Проходим по всем предметам актера и группируем их
  app.actor.items.forEach(item => {
    // Пропускаем предметы, которые уже находятся в контейнерах
    if (item.system?.container) return;
    const itemTab = getItemTab(item);
    if (itemTab === 'inventory' && shouldHideItemFromCellInventory(item)) return;
    const customSectionName = item.getFlag(MODULE_ID, FLAGS.SECTION);
    
    // Проверяем, что customSectionName является строкой и не пустая после trim
    if (customSectionName && typeof customSectionName === 'string' && customSectionName.trim()) {
      logDebug(`Found item "${item.name}" with custom section "${customSectionName}" in tab "${itemTab}"`);
      
      if (!tabSections[itemTab].has(customSectionName)) {
        tabSections[itemTab].set(customSectionName, []);
      }
      tabSections[itemTab].get(customSectionName).push(item);
    }
  });
  
  // Обрабатываем каждую вкладку
  Object.entries(tabSections).forEach(([tabName, customSections]) => {
    if (customSections.size === 0) return;
    
    logDebug(`Processing ${customSections.size} custom sections for tab "${tabName}"`);
    
    // Находим контейнер для соответствующей вкладки
    const tabContainer = findTabContainer(html, tabName);
    if (!tabContainer) {
      logDebug(`Tab container not found for "${tabName}"`);
      return;
    }
    
    // Удаляем предметы с кастомными секциями из стандартных секций
    customSections.forEach((items, sectionName) => {
      items.forEach(item => {
        const itemElement = html.find(`[data-item-id="${item.id}"]`);
        if (itemElement.length) {
          logDebug(`Removing item "${item.name}" from standard section in tab "${tabName}"`);
          itemElement.remove();
        }
      });
    });
    
    // Скрываем пустые стандартные секции
    tabContainer.find('.items-section').each((index, element) => {
      const section = $(element);
      const itemList = section.find('.item-list li.item');
      
      // Если в секции нет предметов, скрываем её
      if (itemList.length === 0) {
        logDebug(`Hiding empty section: ${section.find('.item-name').text().trim()}`);
        section.hide();
      }
    });
    
    // Создаем кастомные секции
    const sortedSectionNames = Array.from(customSections.keys()).sort();
    
    sortedSectionNames.forEach(sectionName => {
      const items = customSections.get(sectionName);
      logDebug(`Creating custom section "${sectionName}" with ${items.length} items in tab "${tabName}"`);
      
      const sectionHtml = createCustomSection(sectionName, items, app, data, tabName);
      tabContainer.append(sectionHtml);
    });
  });
  
  // Добавляем обработчики событий
  attachCustomSectionEventHandlers(html, app);
}

// Функция поиска контейнера вкладки
function findTabContainer(html, tabName) {
  // Для новой версии листов (v2)
  let container = html.find(`.tab.${tabName} .items-list`);
  if (container.length) {
    return container;
  }
  
  // Для старой версии листов
  container = html.find(`.tab.${tabName} .inventory-list`);
  if (container.length) {
    return container;
  }
  
  // Альтернативный поиск
  container = html.find(`[data-tab="${tabName}"] .items-list`);
  if (container.length) {
    return container;
  }
  
  container = html.find(`[data-tab="${tabName}"] .inventory-list`);
  if (container.length) {
    return container;
  }
  
  return null;
}

// Функция создания HTML для кастомной секции
function createCustomSection(sectionName, items, app, data, tabName) {
  // Определяем структуру заголовка в зависимости от вкладки
  let headerHtml = '';
  const gridOn = isIconGridInventoryEnabled() || isCellInventoryEnabled();
  
  if (tabName === 'inventory') {
    if (gridOn) {
      // Заголовок для инвентаря в режиме сетки: только название секции
      headerHtml = `
        <div class="items-header header cis-grid-header">
          <h3 class="item-name">${sectionName}</h3>
        </div>
      `;
    } else {
      // Классический заголовок таблицы
      headerHtml = `
        <div class="items-header header">
          <h3 class="item-name">${sectionName}</h3>
          <div class="item-header item-price">${game.i18n.localize("DND5E.Price")}</div>
          <div class="item-header item-weight">${game.i18n.localize("DND5E.Weight")}</div>
          <div class="item-header item-quantity">${game.i18n.localize("DND5E.Quantity")}</div>
          <div class="item-header item-uses">${game.i18n.localize("DND5E.Charges")}</div>
          <div class="item-header item-controls"></div>
        </div>
      `;
    }
  } else if (tabName === 'features') {
    // Заголовок для особенностей
    headerHtml = `
      <div class="items-header header">
        <h3 class="item-name">${sectionName}</h3>
        <div class="item-header item-uses">${game.i18n.localize("DND5E.Uses")}</div>
        <div class="item-header item-action">${game.i18n.localize("DND5E.Usage")}</div>
        <div class="item-header item-controls"></div>
      </div>
    `;
  } else if (tabName === 'spells') {
    // Заголовок для заклинаний
    headerHtml = `
      <div class="items-header header">
        <h3 class="item-name">${sectionName}</h3>
        <div class="item-header item-school">${game.i18n.localize("DND5E.SpellSchool")}</div>
        <div class="item-header item-action">${game.i18n.localize("DND5E.Usage")}</div>
        <div class="item-header item-controls"></div>
      </div>
    `;
  }
  
  // Создаем HTML для предметов в правильном формате
  let itemsHtml = '';
  items.forEach(item => {
    // Получаем контекст предмета из данных листа
    const itemContext = data.itemContext?.[item.id] || {};
    const uses = item.system.uses;
    const hasUses = uses && (uses.max > 0 || uses.value > 0);
    const isEquipped = item.system.equipped;
    const quantity = item.system.quantity || 1;
    const price = item.system.price?.value || 0;
    const weight = item.system.weight || 0;
    const totalWeight = itemContext.totalWeight || weight;
    
    // Создаем HTML для отдельного предмета в зависимости от вкладки
    if (tabName === 'inventory') {
      if (gridOn) {
        // Для инвентаря используем компактные плитки-ссылки (иконки) без текста
        itemsHtml += createInventoryGridItemHtml(item, itemContext, quantity);
      } else {
        itemsHtml += createInventoryItemHtml(item, itemContext, hasUses, quantity, price, totalWeight, data);
      }
    } else if (tabName === 'features') {
      itemsHtml += createFeatureItemHtml(item, itemContext, hasUses, data);
    } else if (tabName === 'spells') {
      itemsHtml += createSpellItemHtml(item, itemContext, data);
    }
  });
  
  // Возвращаем полный HTML секции
  return $(`
    <div class="items-section card ${tabName === 'inventory' && gridOn ? 'cis-grid' : ''}" data-custom-section="${sectionName}" data-type="custom" data-tab="${tabName}">
      ${headerHtml}
      <ol class="item-list unlist ${tabName === 'inventory' && gridOn ? 'cis-grid-list' : ''}">
        ${itemsHtml}
      </ol>
    </div>
  `);
}

// Функция создания HTML для предмета инвентаря
function createInventoryItemHtml(item, itemContext, hasUses, quantity, price, totalWeight, data) {
  return `
    <li class="item collapsible ${itemContext.isExpanded ? '' : 'collapsed'}" 
        data-item-id="${item.id}" data-entry-id="${item.id}" 
        data-item-name="${item.name}" data-item-sort="${item.sort || 0}"
        data-ungrouped="all" data-grouped="${item.type}" data-item-type="${item.type}">
      
      <div class="item-row">
        
        <!-- Item Name -->
        <div class="item-name item-action item-tooltip" role="button" data-action="use"
             aria-label="${item.name}">
          <img class="item-image gold-icon" src="${item.img}" alt="${item.name}">
          <div class="name name-stacked">
            <span class="title">${item.name}</span>
            ${itemContext.subtitle ? `<span class="subtitle">${itemContext.subtitle}</span>` : ''}
          </div>
          <div class="tags">
            ${item.labels?.properties?.map(prop => 
              prop.icon ? `<span aria-label="${prop.label}"><dnd5e-icon src="${prop.icon}"></dnd5e-icon></span>` : ''
            ).join('') || ''}
          </div>
        </div>
        
        <!-- Item Price -->
        <div class="item-detail item-price ${price > 0 ? '' : 'empty'}">
          ${price > 0 ? `${price}<i class="currency ${item.system.price.denomination || 'gp'}"></i>` : ''}
        </div>
        
        <!-- Item Weight -->
        <div class="item-detail item-weight ${totalWeight > 0 ? '' : 'empty'}">
          ${totalWeight > 0 ? `<i class="fas fa-weight-hanging"></i> ${totalWeight}` : ''}
        </div>
        
        <!-- Item Quantity -->
        <div class="item-detail item-quantity">
          <a class="adjustment-button" data-action="decrease" data-property="system.quantity"><i class="fas fa-minus"></i></a>
          <input type="text" value="${quantity}" placeholder="0" data-dtype="Number"
                 data-name="system.quantity" inputmode="numeric" pattern="[0-9+=\-]*" min="0">
          <a class="adjustment-button" data-action="increase" data-property="system.quantity"><i class="fas fa-plus"></i></a>
        </div>
        
        <!-- Item Uses -->
        <div class="item-detail item-uses ${hasUses ? '' : 'empty'}">
          ${hasUses ? `
            <input type="text" value="${item.system.uses.value}" placeholder="0"
                   data-dtype="Number" data-name="system.uses.value" inputmode="numeric"
                   pattern="[0-9+=\-]*">
            <span class="separator">/</span>
            <span class="max">${item.system.uses.max}</span>
          ` : ''}
        </div>
        
        <!-- Item Controls -->
        <div class="item-detail item-controls">
          ${data.editable ? `
            <a class="item-control item-action" data-action="edit" data-tooltip="DND5E.ItemEdit"
               aria-label="${game.i18n.localize("DND5E.ItemEdit")}">
              <i class="fas fa-pen-to-square"></i>
            </a>
            <a class="item-control item-action" data-action="delete" data-tooltip="DND5E.ItemDelete"
               aria-label="${game.i18n.localize("DND5E.ItemDelete")}">
              <i class="fas fa-trash"></i>
            </a>
          ` : data.owner ? `
            ${itemContext.attunement?.applicable ? `
              <a class="item-control item-action ${itemContext.attunement.cls}" data-action="attune" 
                 data-tooltip="${itemContext.attunement.title}" aria-label="${game.i18n.localize(itemContext.attunement.title)}"
                 aria-disabled="${itemContext.attunement.disabled}">
                <i class="fas fa-sun"></i>
              </a>
            ` : ''}
            ${itemContext.equip?.applicable ? `
              <a class="item-control item-action ${itemContext.equip.cls}" data-action="equip" 
                 data-tooltip="${itemContext.equip.title}" aria-label="${game.i18n.localize(itemContext.equip.title)}"
                 aria-disabled="${itemContext.equip.disabled}">
                <i class="fas fa-shield-halved"></i>
              </a>
            ` : ''}
          ` : ''}
          <a class="item-control interface-only" data-toggle-description
             aria-label="${game.i18n.localize("DND5E.ToggleDescription")}">
            <i class="fas fa-${itemContext.isExpanded ? 'compress' : 'expand'}"></i>
          </a>
          <a class="item-control interface-only" data-context-menu
             aria-label="${game.i18n.localize("DND5E.AdditionalControls")}">
            <i class="fas fa-ellipsis-vertical"></i>
          </a>
        </div>
        
      </div>
      
      <div class="item-description collapsible-content">
        <div class="wrapper">
          ${itemContext.isExpanded ? `<div class="item-summary">${itemContext.expanded || ''}</div>` : ''}
        </div>
      </div>
      
    </li>
  `;
}

// Компактная плитка для предмета инвентаря (представление сеткой)
function createInventoryGridItemHtml(item, itemContext, quantity) {
  const equippedClass = item.system?.equipped ? ' equipped' : '';
  return `
    <li class="item cis-grid-item${equippedClass}" data-item-id="${item.id}" data-entry-id="${item.id}" data-item-name="${item.name}" data-item-sort="${item.sort || 0}" data-item-type="${item.type}">
      <a class="cis-grid-tile item-action item-tooltip" role="button" data-action="use" aria-label="${item.name}">
        <img class="cis-grid-image" src="${item.img}" alt="${item.name}">
        ${quantity > 1 ? `<span class="cis-qty" aria-label="${game.i18n.localize('DND5E.Quantity')}">${quantity}</span>` : ''}
      </a>
    </li>
  `;
}

// Функция создания HTML для особенности
function createFeatureItemHtml(item, itemContext, hasUses, data) {
  return `
    <li class="item collapsible ${itemContext.isExpanded ? '' : 'collapsed'}" 
        data-item-id="${item.id}" data-entry-id="${item.id}" 
        data-item-name="${item.name}" data-item-sort="${item.sort || 0}"
        data-grouped="${itemContext.group || 'feat'}" data-ungrouped="${itemContext.ungroup || 'feat'}">
      
      <div class="item-row">
        
        <!-- Item Name -->
        <div class="item-name item-action item-tooltip" role="button" data-action="use"
             aria-label="${item.name}">
          <img class="item-image gold-icon" src="${item.img}" alt="${item.name}">
          <div class="name name-stacked">
            <span class="title">${item.name}</span>
            ${itemContext.subtitle ? `<span class="subtitle">${itemContext.subtitle}</span>` : ''}
          </div>
          <div class="tags">
            ${item.labels?.properties?.map(prop => 
              prop.icon ? `<span aria-label="${prop.label}"><dnd5e-icon src="${prop.icon}"></dnd5e-icon></span>` : ''
            ).join('') || ''}
          </div>
        </div>
        
        <!-- Item Uses -->
        <div class="item-detail item-uses ${hasUses ? '' : 'empty'}">
          ${hasUses ? `
            <input type="text" value="${item.system.uses.value}" placeholder="0"
                   data-dtype="Number" data-name="system.uses.value" inputmode="numeric"
                   pattern="[0-9+=\-]*">
            <span class="separator">/</span>
            <span class="max">${item.system.uses.max}</span>
          ` : ''}
        </div>
        
        <!-- Item Action -->
        <div class="item-detail item-action">
          ${item.system.activation?.type ? item.labels.activation : ''}
        </div>
        
        <!-- Item Controls -->
        <div class="item-detail item-controls">
          ${data.editable ? `
            <a class="item-control item-action" data-action="edit" data-tooltip="DND5E.ItemEdit"
               aria-label="${game.i18n.localize("DND5E.ItemEdit")}">
              <i class="fas fa-pen-to-square"></i>
            </a>
            <a class="item-control item-action" data-action="delete" data-tooltip="DND5E.ItemDelete"
               aria-label="${game.i18n.localize("DND5E.ItemDelete")}">
              <i class="fas fa-trash"></i>
            </a>
          ` : ''}
          <a class="item-control interface-only" data-toggle-description
             aria-label="${game.i18n.localize("DND5E.ToggleDescription")}">
            <i class="fas fa-${itemContext.isExpanded ? 'compress' : 'expand'}"></i>
          </a>
          <a class="item-control interface-only" data-context-menu
             aria-label="${game.i18n.localize("DND5E.AdditionalControls")}">
            <i class="fas fa-ellipsis-vertical"></i>
          </a>
        </div>
        
      </div>
      
      <div class="item-description collapsible-content">
        <div class="wrapper">
          ${itemContext.isExpanded ? `<div class="item-summary">${itemContext.expanded || ''}</div>` : ''}
        </div>
      </div>
      
    </li>
  `;
}

// Функция создания HTML для заклинания
function createSpellItemHtml(item, itemContext, data) {
  return `
    <li class="item collapsible ${itemContext.isExpanded ? '' : 'collapsed'}" 
        data-item-id="${item.id}" data-entry-id="${item.id}" 
        data-item-name="${item.name}" data-item-sort="${item.sort || 0}"
        data-grouped="spell" data-ungrouped="spell">
      
      <div class="item-row">
        
        <!-- Item Name -->
        <div class="item-name item-action item-tooltip" role="button" data-action="use"
             aria-label="${item.name}">
          <img class="item-image gold-icon" src="${item.img}" alt="${item.name}">
          <div class="name name-stacked">
            <span class="title">${item.name}</span>
            ${itemContext.subtitle ? `<span class="subtitle">${itemContext.subtitle}</span>` : ''}
          </div>
          <div class="tags">
            ${item.labels?.properties?.map(prop => 
              prop.icon ? `<span aria-label="${prop.label}"><dnd5e-icon src="${prop.icon}"></dnd5e-icon></span>` : ''
            ).join('') || ''}
          </div>
        </div>
        
        <!-- Spell School -->
        <div class="item-detail item-school">
          ${item.labels.school || ''}
        </div>
        
        <!-- Item Action -->
        <div class="item-detail item-action">
          ${item.system.activation?.type ? item.labels.activation : ''}
        </div>
        
        <!-- Item Controls -->
        <div class="item-detail item-controls">
          ${data.editable ? `
            <a class="item-control item-action" data-action="edit" data-tooltip="DND5E.ItemEdit"
               aria-label="${game.i18n.localize("DND5E.ItemEdit")}">
              <i class="fas fa-pen-to-square"></i>
            </a>
            <a class="item-control item-action" data-action="delete" data-tooltip="DND5E.ItemDelete"
               aria-label="${game.i18n.localize("DND5E.ItemDelete")}">
              <i class="fas fa-trash"></i>
            </a>
          ` : ''}
          <a class="item-control interface-only" data-toggle-description
             aria-label="${game.i18n.localize("DND5E.ToggleDescription")}">
            <i class="fas fa-${itemContext.isExpanded ? 'compress' : 'expand'}"></i>
          </a>
          <a class="item-control interface-only" data-context-menu
             aria-label="${game.i18n.localize("DND5E.AdditionalControls")}">
            <i class="fas fa-ellipsis-vertical"></i>
          </a>
        </div>
        
      </div>
      
      <div class="item-description collapsible-content">
        <div class="wrapper">
          ${itemContext.isExpanded ? `<div class="item-summary">${itemContext.expanded || ''}</div>` : ''}
        </div>
      </div>
      
    </li>
  `;
}

// Функция добавления обработчиков событий для кастомных секций
function attachCustomSectionEventHandlers(html, app) {
  // Применяем tooltip'ы к элементам в кастомных секциях
  html.find('[data-custom-section] .item-tooltip').each((index, element) => {
    applyItemTooltips(element, app);
  });
  
  // БЛОКИРОВКА РЕДАКТИРОВАНИЯ КОЛИЧЕСТВА ДЛЯ НЕ-GM ПОЛЬЗОВАТЕЛЕЙ
  if (!game.user.isGM) {
    // Блокируем поля ввода количества
    html.find('[data-custom-section] input[data-name="system.quantity"]').each(function() {
      const input = $(this);
      // Сохраняем исходное значение
      input.attr('data-prev-value', input.val());
      // Делаем поле только для чтения
      input.prop('readonly', true);
      input.attr('title', 'Только GM может изменять количество предметов');
    });
    
    // Блокируем кнопки увеличения/уменьшения количества
    html.find('[data-custom-section] .adjustment-button').each(function() {
      const button = $(this);
      button.addClass('disabled-quantity-btn');
      button.attr({
        'disabled': 'disabled',
        'title': 'Только GM может изменять количество предметов'
      });
    });
  }
  
  // Обработчик для изменения количества (только для GM)
  html.find('[data-custom-section] input[data-name="system.quantity"]').change(async (event) => {
    // Пропускаем обработку для не-GM пользователей
    if (!game.user.isGM) {
      const input = $(event.currentTarget);
      const prevValue = input.attr('data-prev-value');
      if (prevValue !== undefined) {
        input.val(prevValue);
      }
      event.preventDefault();
      event.stopPropagation();
      ui.notifications.warn("Только GM может изменять количество предметов");
      return false;
    }
    
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const value = Number(event.currentTarget.value);
    const item = app.actor.items.get(itemId);
    if (item) {
      logDebug(`Updating quantity for item ${item.name} to ${value}`);
      await item.update({ "system.quantity": value });
    }
  });
  
  // Обработчик для изменения использований
  html.find('[data-custom-section] input[data-name="system.uses.value"]').change(async (event) => {
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const value = Number(event.currentTarget.value);
    const item = app.actor.items.get(itemId);
    if (item) {
      logDebug(`Updating uses for item ${item.name} to ${value}`);
      await item.update({ "system.uses.value": value });
    }
  });
  
  // Обработчик для кнопок увеличения/уменьшения количества (только для GM)
  html.find('[data-custom-section] .adjustment-button').click(async (event) => {
    // Пропускаем обработку для не-GM пользователей
    if (!game.user.isGM) {
      event.preventDefault();
      event.stopPropagation();
      ui.notifications.warn("Только GM может изменять количество предметов");
      return false;
    }
    
    const action = $(event.currentTarget).data('action');
    const property = $(event.currentTarget).data('property');
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const item = app.actor.items.get(itemId);
    
    if (item) {
      const currentValue = item.system.quantity || 0;
      const newValue = action === 'increase' ? currentValue + 1 : Math.max(0, currentValue - 1);
      logDebug(`${action} quantity for item ${item.name} to ${newValue}`);
      await item.update({ [property]: newValue });
    }
  });
  
  // Обработчик для редактирования предмета
  html.find('[data-custom-section] [data-action="edit"]').click(async (event) => {
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const item = app.actor.items.get(itemId);
    if (item) {
      logDebug(`Opening item sheet for ${item.name}`);
      item.sheet.render(true);
    }
  });
  
  // Обработчик клика по предмету: Shift+ЛКМ — (раз)надеть; контейнеры — развернуть; иначе use
  html.find('[data-custom-section] [data-action="use"]').off('click.cis-use').on('click.cis-use', async (event) => {
    const li = event.currentTarget.closest('.item');
    if (!li) return;
    const itemId = li.dataset.itemId;
    const item = app.actor.items.get(itemId);
    if (!item) return;
    if (isQuickTransferEvent(event) && getItemTab(item) === 'inventory') {
      event.preventDefault();
      event.stopPropagation();
      await quickTransferItem(app, item);
      return;
    }
    // Shift+ЛКМ: переключение экипировки, если поддерживается
    if (event.shiftKey && (item.system?.equipped !== undefined)) {
      event.preventDefault();
      event.stopPropagation();
      await toggleEquip(item, li);
      return;
    }
    if (item.type === 'container') {
      event.preventDefault();
      event.stopPropagation();
      await toggleInlineContainer(app, html, li, item);
      return;
    }
    // Делегируем системному обработчику, если находимся внутри dnd5e-inventory
    const invEl = event.currentTarget.closest('dnd5e-inventory');
    if (invEl && typeof invEl._onAction === 'function') {
      event.preventDefault();
      event.stopPropagation();
      await invEl._onAction(event.currentTarget, 'use');
      return;
    }
    await item.use({}, { event });
  });
  
  // Обработчик для удаления предмета
  html.find('[data-custom-section] [data-action="delete"]').click(async (event) => {
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const item = app.actor.items.get(itemId);
    if (item) {
      logDebug(`Attempting to delete item ${item.name}`);
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("DND5E.ItemDelete"),
        content: `<p>${game.i18n.format("DND5E.ItemDeleteConfirm", {item: item.name})}</p>`
      });
      if (confirmed) {
        await item.delete();
        logDebug(`Deleted item ${item.name}`);
      }
    }
  });
  
  // Обработчик для переключения описания
  html.find('[data-custom-section] [data-toggle-description]').click(async (event) => {
    const itemElement = $(event.currentTarget).closest('.item');
    const itemId = itemElement.data('item-id');
    const item = app.actor.items.get(itemId);
    
    if (item) {
      const isExpanded = itemElement.hasClass('collapsed');
      logDebug(`Toggling description for item ${item.name}, expanded: ${isExpanded}`);
      
      // Обновляем класс элемента
      if (isExpanded) {
        itemElement.removeClass('collapsed');
      } else {
        itemElement.addClass('collapsed');
      }
      
      // Обновляем иконку
      const icon = $(event.currentTarget).find('i');
      icon.removeClass('fa-expand fa-compress');
      icon.addClass(isExpanded ? 'fa-compress' : 'fa-expand');
    }
  });

  // DnD для всех предметов в кастомных секциях
  wireItemDragDrop(app, html.find('[data-custom-section] .item[data-item-id]'));

  // Зона для дропа на корень инвентаря (вкладка inventory)
  const inventoryRoot = html[0]?.querySelector('.tab.inventory .items-list');
  if (inventoryRoot) {
    if (!wiredDropZones.has(inventoryRoot)) {
      inventoryRoot.addEventListener('dragover', (event) => {
        if (isCellInventoryEnabled()) return;
        if (event.target?.closest?.('.cis-grid-item, .cis-cell-inventory-cell')) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      inventoryRoot.addEventListener('drop', async (event) => {
        if (isCellInventoryEnabled()) return;
        if (event.target?.closest?.('.cis-grid-item, .cis-cell-inventory-cell')) return;
        event.preventDefault();
        event.stopPropagation();
        try {
          const str = event.dataTransfer?.getData('text/plain');
          if (!str) return;
          const dropData = JSON.parse(str);
          const dropped = await resolveDroppedItem(app, dropData);
          if (!dropped) return;
          await moveItemToRoot(app, dropped, dropData);
        } catch (e) { /* ignore */ }
      });
      wiredDropZones.add(inventoryRoot);
    }
  }
}

// Применяет DnD-обработчики к коллекции DOM-элементов предметов
function wireItemDragDrop(app, $elements) {
  $elements.each((index, element) => {
    const $element = $(element);
    const itemId = $element.data('item-id');
    const item = app.actor.items.get(itemId);
    if (!item) return;
    
      element.draggable = true;
      element.addEventListener('dragstart', (event) => {
      beginOwnedItemSheetDrag(app.actor, item, event);
        $element.addClass('dragging');
      });
    element.addEventListener('dragend', () => {
      finishOwnedItemSheetDrag();
      $element.removeClass('dragging');
    });
      element.addEventListener('dragover', (event) => {
        event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      element.addEventListener('drop', async (event) => {
        event.preventDefault();
      event.stopPropagation();
      try {
        const dropStr = event.dataTransfer?.getData('text/plain');
        if (!dropStr) return;
        const dropData = JSON.parse(dropStr);
        const dropped = await resolveDroppedItem(app, dropData);
        if (!dropped) return;
        if (item.type === 'container' && dropped.id !== item.id) {
          await moveItemToContainer(app, dropped, item, dropData);
          return;
        }
        await moveItemToRoot(app, dropped, dropData);
      } catch (error) {
        console.error(`${MODULE_ID} | Error processing drop:`, error);
      }
    });
  });
}

// Переключение экипировки с обновлением классов и подсветки
async function toggleEquip(item, liElement, { app = null, html = null } = {}) {
  const equipped = Boolean(item.system?.equipped);
  await item.update({ 'system.equipped': !equipped });
  const li = liElement instanceof HTMLElement ? liElement : (liElement?.[0] ?? null);
  if (li) li.classList.toggle('equipped', !equipped);

  if (item.type !== 'container' || !app || !shouldUseContainerCellInventoryGrid(app)) return;
  const currentHtml = html instanceof jQuery ? html : (app.element instanceof jQuery ? app.element : $(app.element));
  if (currentHtml?.length) applyCellInventory(app, currentHtml);
}

// Переключить inline-разворот контейнера
async function toggleInlineContainer(app, html, liElement, containerItem) {
  const $li = $(liElement);
  const actorExpanded = getExpandedContainersForActor(app.actor.id);
  // Проверяем существование панели как соседнего элемента или как внутри обертки
  let nextEl = $li.next();
  if (nextEl.length === 0 && $li.parent().hasClass('cis-grid-row')) {
    nextEl = $li.parent().children('.cis-container-contents');
  }
  const alreadyExpanded = nextEl.length && nextEl.hasClass('cis-container-contents');

  if (alreadyExpanded) {
    if ($li.parent().hasClass('cis-grid-row')) {
      $li.parent().children('.cis-container-contents').remove();
      // Возвращаем li обратно вместо обертки
      const wrapper = $li.parent()[0];
      $(wrapper).replaceWith($li);
    } else {
      $li.next('.cis-container-contents').remove();
    }
    actorExpanded.delete(containerItem.id);
    return;
  }

  const panel = await buildContainerContentsPanel(app, containerItem);
  // Вставка справа в сетке, иначе ниже
  if ($li.hasClass('cis-grid-item')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cis-grid-row';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '8px';
    wrapper.style.alignItems = 'flex-start';
    $li.replaceWith(wrapper);
    wrapper.appendChild(liElement);
    wrapper.appendChild(panel[0]);
  } else {
    $li.after(panel);
  }
  actorExpanded.add(containerItem.id);
}

// Построить панель содержимого контейнера
function getContainerUsedSlotCount(items = []) {
  return items.reduce((total, item) => {
    const size = getCellInventorySize(item);
    return total + (size.width * size.height);
  }, 0);
}

function getContainerCapacityHint(containerItem, capacity) {
  const capacityLabel = game.i18n.localize(CONFIG.DND5E.itemCapacityTypes?.[containerItem.system.capacity?.type || 'weight'] ?? '');
  const value = Math.round(Number(capacity?.value ?? 0) * 100) / 100;
  const max = Number(capacity?.max);
  const maxLabel = Number.isFinite(max) ? max : '&infin;';
  const units = capacity?.units ? ` ${escapeHtml(capacity.units)}` : '';
  if (!capacityLabel) return `${value} / ${maxLabel}${units}`;
  return `${escapeHtml(capacityLabel)}: ${value} / ${maxLabel}${units}`;
}

function isOpenableContainerItem(item) {
  return item?.type === 'container'
    && item?.parent?.documentName === 'Actor'
    && item?.parent?.isOwner;
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function getContainerWindowKey(actorId, containerId) {
  if (!actorId || !containerId) return null;
  return `${actorId}:${containerId}`;
}

function getContainerWindowActorKey(actorLike) {
  return actorLike?.uuid ?? actorLike?.id ?? null;
}

function isQuickTransferEvent(event) {
  return Boolean(event?.ctrlKey);
}

function markApplicationWindowFocus(app) {
  if (!app) return;
  app._cisFocusOrder = ++containerWindowFocusCounter;
}

function sortContainerWindowsByFocus(windows = []) {
  return [...windows].sort((left, right) => (
    Number(right?._cisFocusOrder ?? 0) - Number(left?._cisFocusOrder ?? 0)
  ) || compareCellInventoryStrings(left?.containerName, right?.containerName));
}

function getOpenContainerWindowsForActorKey(actorKey) {
  if (!actorKey) return [];

  const windows = [];
  for (const windowApp of openContainerWindows.values()) {
    if (!windowApp || windowApp.actorKey !== actorKey) continue;
    windows.push(windowApp);
  }
  return windows;
}

function getOpenContainerWindowsForActor(actorLike) {
  return getOpenContainerWindowsForActorKey(getContainerWindowActorKey(actorLike));
}

function isContainerNestedWithin(actor, containerId, potentialAncestorId) {
  if (!actor || !containerId || !potentialAncestorId) return false;

  const visited = new Set();
  let currentId = containerId;
  while (currentId && !visited.has(currentId)) {
    if (currentId === potentialAncestorId) return true;
    visited.add(currentId);
    currentId = actor.items?.get(currentId)?.system?.container ?? null;
  }

  return false;
}

function canQuickTransferItemIntoContainer(actor, item, targetContainer, {
  excludeContainerIds = null
} = {}) {
  if (!actor || !item || !targetContainer) return false;
  if (item.parent !== actor || targetContainer.parent !== actor) return false;
  if (targetContainer.type !== 'container') return false;
  if (excludeContainerIds?.has?.(targetContainer.id)) return false;
  if (targetContainer.id === item.id) return false;
  if ((item.system?.container ?? null) === targetContainer.id) return false;
  if (item.type === 'container' && isContainerNestedWithin(actor, targetContainer.id, item.id)) return false;
  return true;
}

function getOpenQuickTransferContainers(actor, item, {
  excludeContainerIds = null,
  requireEquipped = false
} = {}) {
  const containers = [];
  const seenIds = new Set();

  for (const windowApp of sortContainerWindowsByFocus(getOpenContainerWindowsForActor(actor))) {
    if (!windowApp?.rendered) continue;

    const targetContainer = windowApp.containerItem;
    if (!targetContainer || seenIds.has(targetContainer.id)) continue;
    if (requireEquipped && !targetContainer.system?.equipped) continue;
    if (!canQuickTransferItemIntoContainer(actor, item, targetContainer, { excludeContainerIds })) continue;

    seenIds.add(targetContainer.id);
    containers.push(targetContainer);
  }

  return containers;
}

function getQuickTransferEquippedContainers(actor, item, {
  excludeContainerIds = null
} = {}) {
  if (!actor) return [];

  const containers = [];
  const seenIds = new Set();

  for (const openContainer of getOpenQuickTransferContainers(actor, item, {
    excludeContainerIds,
    requireEquipped: true
  })) {
    seenIds.add(openContainer.id);
    containers.push(openContainer);
  }

  for (const targetContainer of actor.items) {
    if (seenIds.has(targetContainer.id)) continue;
    if (targetContainer.type !== 'container') continue;
    if (targetContainer.system?.container) continue;
    if (!targetContainer.system?.equipped) continue;
    if (getItemTab(targetContainer) !== 'inventory') continue;
    if (!canQuickTransferItemIntoContainer(actor, item, targetContainer, { excludeContainerIds })) continue;

    seenIds.add(targetContainer.id);
    containers.push(targetContainer);
  }

  return containers;
}

function resolveRootInventoryPlacement(actor, itemLike, {
  preferredPosition = null,
  ignoredIds = new Set()
} = {}) {
  const gridDimensions = getCellInventoryGridDimensions(CELL_INVENTORY);
  const mergeTarget = actor ? findMergeTarget(actor, itemLike, null) : null;
  if (mergeTarget) {
    return {
      position: getStoredCellInventoryPosition(mergeTarget, actor?.id ?? null, gridDimensions),
      reason: null,
      gridDimensions,
      mergeTarget
    };
  }

  const size = getCellInventorySize(itemLike);
  if (!doesCellInventorySizeFitGrid(size, gridDimensions)) {
    return {
      position: null,
      reason: 'slots',
      gridDimensions,
      mergeTarget: null
    };
  }

  const layoutState = collectCellInventoryLayoutState(actor);
  if (preferredPosition) {
    const preferredPlacement = getCellInventoryPlacementState(
      layoutState,
      preferredPosition,
      size,
      ignoredIds,
      gridDimensions
    );
    if (preferredPlacement.isValid) {
      return {
        position: preferredPlacement.position,
        reason: null,
        gridDimensions,
        mergeTarget: null,
        layoutState
      };
    }
    return {
      position: null,
      reason: 'slots',
      gridDimensions,
      mergeTarget: null,
      layoutState
    };
  }

  const autoPosition = findNextFreeCellInventoryPosition(layoutState.occupiedCells, size, gridDimensions);
  return {
    position: autoPosition,
    reason: autoPosition ? null : 'slots',
    gridDimensions,
    mergeTarget: null,
    layoutState
  };
}

async function quickTransferItemToRoot(app, item) {
  if (!app?.actor || !item) return false;

  const placement = resolveRootInventoryPlacement(app.actor, item);
  if (!placement.mergeTarget && !placement.position) return false;

  const itemId = item.id;
  const succeeded = await moveItemToRoot(app, item, {
    amount: Math.max(1, Number(item.system?.quantity ?? 1)),
    skipQuantityPrompt: true,
    suppressNotifications: true
  });
  if (!succeeded) return false;

  if (!placement.mergeTarget && placement.position) {
    const movedItem = app.actor.items.get(itemId);
    if (movedItem && !movedItem.system?.container) {
      await moveRootInventoryItemToCell(app, movedItem, placement.position);
    }
  }

  return true;
}

function warnQuickTransferUnavailable() {
  ui.notifications?.warn?.(localizeSafe(
    'CUSTOM_SECTIONS.QuickTransferUnavailable',
    'No available space for quick transfer.'
  ));
}

async function quickTransferItem(app, item) {
  const actor = app?.actor ?? item?.parent ?? null;
  if (!actor?.isOwner || !item || item.parent !== actor) return false;
  if (getItemTab(item) !== 'inventory') return false;

  const sourceContainerId = item.system?.container ?? null;
  const excludedContainerIds = new Set(sourceContainerId ? [sourceContainerId] : []);
  const triedContainerIds = new Set();

  const tryContainerList = async (containers = []) => {
    for (const targetContainer of containers) {
      if (!targetContainer || triedContainerIds.has(targetContainer.id)) continue;
      triedContainerIds.add(targetContainer.id);

      const moved = await moveItemToContainer(app, item, targetContainer, {
        amount: Math.max(1, Number(item.system?.quantity ?? 1)),
        skipQuantityPrompt: true,
        suppressNotifications: true
      });
      if (moved) return true;
    }
    return false;
  };

  if (sourceContainerId) {
    if (await quickTransferItemToRoot(app, item)) return true;
    if (await tryContainerList(getQuickTransferEquippedContainers(actor, item, { excludeContainerIds: excludedContainerIds }))) return true;
    if (await tryContainerList(getOpenQuickTransferContainers(actor, item, { excludeContainerIds: excludedContainerIds }))) return true;
    warnQuickTransferUnavailable();
    return false;
  }

  if (await tryContainerList(getOpenQuickTransferContainers(actor, item, { excludeContainerIds: excludedContainerIds }))) return true;
  if (await tryContainerList(getQuickTransferEquippedContainers(actor, item, { excludeContainerIds: excludedContainerIds }))) return true;

  warnQuickTransferUnavailable();
  return false;
}

function bringOpenContainerWindowsToFront(actorLike) {
  const windows = getOpenContainerWindowsForActor(actorLike);
  if (!windows.length) return;

  for (const windowApp of windows) {
    if (!windowApp?.rendered) continue;
    focusApplicationWindow(windowApp);
  }
}

function scheduleBringOpenContainerWindowsToFront(actorLike) {
  const actorKey = getContainerWindowActorKey(actorLike);
  if (!actorKey || !getOpenContainerWindowsForActorKey(actorKey).length) return;

  const apply = () => {
    try {
      bringOpenContainerWindowsToFront(actorLike);
    } catch (_) { /* ignore */ }
  };

  apply();
  globalThis.queueMicrotask?.(apply);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  setTimeout(apply, 0);
  setTimeout(apply, 40);
}

function installActorSheetContainerWindowPrioritySync(actorLike) {
  const actorKey = getContainerWindowActorKey(actorLike);
  const sheet = actorLike?.sheet;
  if (!actorKey || !sheet || typeof sheet.bringToTop !== 'function') return;

  const existing = actorSheetPrioritySyncByActor.get(actorKey);
  if (existing?.sheet === sheet) return;

  if (existing) uninstallActorSheetContainerWindowPrioritySync(actorKey);

  const originalBringToTop = sheet.bringToTop;
  sheet.bringToTop = function cisContainerAwareBringToTop(...args) {
    const result = originalBringToTop.call(this, ...args);
    scheduleBringOpenContainerWindowsToFront(actorLike);
    return result;
  };

  actorSheetPrioritySyncByActor.set(actorKey, {
    sheet,
    originalBringToTop
  });
}

function uninstallActorSheetContainerWindowPrioritySync(actorKey) {
  if (!actorKey) return;

  if (getOpenContainerWindowsForActorKey(actorKey).length) return;

  const existing = actorSheetPrioritySyncByActor.get(actorKey);
  if (!existing) return;

  try {
    if (existing.sheet?.bringToTop && existing.originalBringToTop) {
      existing.sheet.bringToTop = existing.originalBringToTop;
    }
  } catch (_) { /* ignore */ }

  actorSheetPrioritySyncByActor.delete(actorKey);
}

function getContainerWindowViewportBounds() {
  const viewportWidth = Number(globalThis.innerWidth) || 1600;
  const viewportHeight = Number(globalThis.innerHeight) || 900;
  return {
    width: Math.max(CONTAINER_WINDOW.minWidth, Math.floor(viewportWidth * CONTAINER_WINDOW.viewportWidthRatio)),
    height: Math.max(CONTAINER_WINDOW.minHeight, Math.floor(viewportHeight * CONTAINER_WINDOW.viewportHeightRatio))
  };
}

function getContainerWindowCellSize(gridDimensions) {
  const grid = getCellInventoryGridDimensions(gridDimensions);
  const bounds = getContainerWindowViewportBounds();
  const maxCellWidth = Math.floor((bounds.width - CONTAINER_WINDOW.widthPadding) / Math.max(1, grid.columns));
  const maxCellHeight = Math.floor((bounds.height - CONTAINER_WINDOW.heightPadding) / Math.max(1, grid.rows));
  return clampNumber(
    Math.min(CONTAINER_WINDOW.preferredCellSize, maxCellWidth, maxCellHeight),
    CONTAINER_WINDOW.minCellSize,
    CONTAINER_WINDOW.maxCellSize
  );
}

function getContainerWindowMetrics(containerItem) {
  const grid = getContainerGridLayout(containerItem);
  const cellSize = getContainerWindowCellSize(grid);
  const bounds = getContainerWindowViewportBounds();
  return {
    grid,
    cellSize,
    width: clampNumber((grid.columns * cellSize) + CONTAINER_WINDOW.widthPadding, CONTAINER_WINDOW.minWidth, bounds.width),
    height: clampNumber((grid.rows * cellSize) + CONTAINER_WINDOW.heightPadding, CONTAINER_WINDOW.minHeight, bounds.height)
  };
}

function restoreScrollStateDeferred(root, states = []) {
  if (!root || !states.length) return;

  const applyScroll = () => {
    try {
      restoreScrollStabilizerState(root, states);
    } catch (_) { /* ignore */ }
  };

  applyScroll();
  globalThis.queueMicrotask?.(applyScroll);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyScroll);
  setTimeout(applyScroll, 0);
  setTimeout(applyScroll, 50);
  setTimeout(applyScroll, 150);
}

function focusApplicationWindow(app) {
  if (!app) return;
  try {
    app.maximize?.();
  } catch (_) { /* ignore */ }
  try {
    app.bringToTop?.();
  } catch (_) { /* ignore */ }
  markApplicationWindowFocus(app);
}

async function openContainerWindow(containerItem) {
  if (!isOpenableContainerItem(containerItem)) return null;

  installActorSheetContainerWindowPrioritySync(containerItem.parent);

  const key = getContainerWindowKey(getContainerWindowActorKey(containerItem.parent), containerItem.id);
  if (!key) return null;

  const existingWindow = openContainerWindows.get(key);
  if (existingWindow) {
    existingWindow.render(false, { focus: true });
    focusApplicationWindow(existingWindow);
    return existingWindow;
  }

  const windowApp = new CellInventoryContainerWindow(containerItem);
  openContainerWindows.set(key, windowApp);
  try {
    await windowApp.render(true, { focus: true });
  } catch (error) {
    openContainerWindows.delete(key);
    throw error;
  }
  focusApplicationWindow(windowApp);
  return windowApp;
}

class CellInventoryContainerWindow extends Application {
  constructor(containerItem) {
    super();
    this._actor = containerItem?.parent ?? null;
    this.actorId = containerItem?.parent?.id ?? null;
    this.actorUuid = containerItem?.parent?.uuid ?? null;
    this.actorKey = getContainerWindowActorKey(containerItem?.parent);
    this.containerId = containerItem?.id ?? null;
    this.containerName = containerItem?.name ?? '';
    this._pendingRenderTimer = null;
    this._hookIds = [];
    this._registerHooks();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'cis-container-window',
      template: `modules/${MODULE_ID}/templates/apps/cell-inventory-container-window.hbs`,
      popOut: true,
      resizable: false,
      minimizable: true,
      width: 560,
      height: 620,
      classes: ['dnd5e', 'cis-container-window-app'],
      scrollY: ['.cis-container-window-grid-host']
    });
  }

  get actor() {
    if (this._actor) return this._actor;
    if (typeof globalThis.fromUuidSync === 'function' && this.actorUuid) {
      try {
        this._actor = globalThis.fromUuidSync(this.actorUuid) ?? null;
      } catch (_) { /* ignore */ }
    }
    if (!this._actor && this.actorId) {
      this._actor = game.actors?.get(this.actorId) ?? null;
    }
    return this._actor ?? null;
  }

  get containerItem() {
    return this.actor?.items?.get(this.containerId) ?? null;
  }

  get id() {
    const actorKey = String(this.actorKey ?? this.actorId ?? 'actor').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `cis-container-window-${actorKey}-${this.containerId ?? 'container'}`;
  }

  get title() {
    const containerItem = this.containerItem;
    return String(containerItem?.name ?? this.containerName ?? this.containerId ?? localizeSafe('CUSTOM_SECTIONS.OpenContainer', 'Open'));
  }

  _registerHooks() {
    this._hookIds.push(
      ['createItem', Hooks.on('createItem', (item) => this._onActorItemChange(item))],
      ['updateItem', Hooks.on('updateItem', (item) => this._onActorItemChange(item))],
      ['deleteItem', Hooks.on('deleteItem', (item) => this._onActorItemDelete(item))],
      ['updateActor', Hooks.on('updateActor', (actor) => this._onActorUpdate(actor))]
    );
  }

  _clearHooks() {
    for (const [hookName, hookId] of this._hookIds) {
      try {
        Hooks.off(hookName, hookId);
      } catch (_) { /* ignore */ }
    }
    this._hookIds = [];
  }

  _matchesActor(actor) {
    if (!actor) return false;
    if (this.actorUuid && actor.uuid === this.actorUuid) return true;
    return Boolean(actor.id) && actor.id === this.actorId;
  }

  _onActorItemChange(item) {
    if (!this._matchesActor(item?.parent)) return;
    if (!this.containerItem && item?.id === this.containerId) {
      this.close();
      return;
    }
    this.scheduleRefresh();
  }

  _onActorItemDelete(item) {
    if (!this._matchesActor(item?.parent)) return;
    if (item?.id === this.containerId) {
      this.close();
      return;
    }
    this.scheduleRefresh();
  }

  _onActorUpdate(actor) {
    if (!this._matchesActor(actor)) return;
    if (!this.containerItem) {
      this.close();
      return;
    }
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    if (this._pendingRenderTimer) return;
    this._pendingRenderTimer = setTimeout(() => {
      this._pendingRenderTimer = null;
      if (!this.rendered) return;
      if (!this.containerItem) {
        this.close();
        return;
      }
      this.render(false);
    }, 0);
  }

  async _render(force, options) {
    const rootBefore = this.element?.[0] ?? null;
    const savedState = collectScrollStabilizerState(rootBefore, getScrollStabilizerSelectors(this));
    const result = await super._render(force, options);
    const rootAfter = this.element?.[0] ?? null;
    restoreScrollStateDeferred(rootAfter, savedState);
    return result;
  }

  async close(options = {}) {
    if (this._pendingRenderTimer) {
      clearTimeout(this._pendingRenderTimer);
      this._pendingRenderTimer = null;
    }
    this._clearHooks();
    const key = getContainerWindowKey(this.actorKey ?? this.actorUuid ?? this.actorId, this.containerId);
    if (key) openContainerWindows.delete(key);
    uninstallActorSheetContainerWindowPrioritySync(this.actorKey ?? this.actorUuid ?? this.actorId);
    return super.close(options);
  }

  async getData(options = {}) {
    const data = await super.getData(options);
    const actor = this.actor;
    const containerItem = this.containerItem;
    if (!actor || !containerItem) {
      return {
        ...data,
        missing: true,
        missingLabel: escapeHtml(localizeSafe('CUSTOM_SECTIONS.ContainerMissing', 'Container unavailable.'))
      };
    }

    this.containerName = containerItem.name ?? this.containerName;

    const layoutState = collectContainerInventoryLayoutState(actor, containerItem);
    const capacity = await containerItem.system.computeCapacity();
    const metrics = getContainerWindowMetrics(containerItem);

    return {
      ...data,
      actor,
      container: containerItem,
      missing: false,
      cellSize: metrics.cellSize,
      gridHtml: createCellInventoryGridMarkup(layoutState, { containerId: containerItem.id }),
      capacityHintHtml: getContainerCapacityHint(containerItem, capacity),
      slotsLabel: escapeHtml(localizeSafe('CUSTOM_SECTIONS.ContainerSlots', 'Slots')),
      volumeLabel: escapeHtml(localizeSafe('CUSTOM_SECTIONS.ContainerVolumeShort', 'Volume')),
      usedSlots: getContainerUsedSlotCount(layoutState.items),
      totalSlots: metrics.grid.columns * metrics.grid.rows,
      volumeValue: `${metrics.grid.columns} x ${metrics.grid.rows}`,
      overflowText: layoutState.overflow.length
        ? escapeHtml(formatLocalizeSafe(
          'CUSTOM_SECTIONS.CellInventory.Overflow',
          { count: layoutState.overflow.length },
          `Overflow: ${layoutState.overflow.length}`
        ))
        : '',
      windowWidth: metrics.width,
      windowHeight: metrics.height
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.containerItem) return;

    html.off('.cis-container-window-focus');
    html.on('pointerdown.cis-container-window-focus mousedown.cis-container-window-focus', () => {
      markApplicationWindowFocus(this);
    });

    html.find('.item-tooltip').each((_, element) => {
      applyItemTooltips(element, this);
    });

    activateContainerWindowGrid(this, html);

    const metrics = getContainerWindowMetrics(this.containerItem);
    this.setPosition({
      width: metrics.width,
      height: metrics.height
    });
  }
}

function activateContainerWindowGrid(app, html) {
  const host = html.find('.cis-container-window-grid-host').first();
  if (!host.length) return;

  host.off('.cis-container-window');

  host.on('click.cis-container-window', '.cis-cell-inventory-item .cis-cell-inventory-tile', async (event) => {
    const itemElement = event.currentTarget.closest('.cis-cell-inventory-item');
    if (!itemElement) return;
    const item = app.actor?.items?.get(itemElement.dataset.itemId);
    if (!item) return;
    if (isQuickTransferEvent(event) && getItemTab(item) === 'inventory') {
      event.preventDefault();
      event.stopPropagation();
      await quickTransferItem(app, item);
      return;
    }

    if (event.shiftKey && (item.system?.equipped !== undefined)) {
      event.preventDefault();
      event.stopPropagation();
      await toggleEquip(item, itemElement);
      return;
    }

    if (item.type === 'container') return;

    await item.use({}, { event });
  });

  host.on('dragstart.cis-container-window', '.cis-cell-inventory-item', (event) => {
    const itemElement = event.currentTarget.closest('.cis-cell-inventory-item');
    if (!itemElement) return;
    const item = app.actor?.items?.get(itemElement.dataset.itemId);
    if (!item) return;
    beginOwnedItemSheetDrag(app.actor, item, event);
    itemElement.classList.add('dragging');
  });

  host.on('dragend.cis-container-window', '.cis-cell-inventory-item', () => {
    clearCellInventoryDragState(host);
    finishOwnedItemSheetDrag();
  });

  host.on('dragover.cis-container-window', '.cis-cell-inventory-grid-stack', (event) => {
    event.preventDefault();
    const nativeEvent = event.originalEvent ?? event;
    const scopeContext = getCellInventoryGridScopeContext(app, event.currentTarget);
    if (!scopeContext.layoutState) return;

    const { dragSize, ignoredIds } = getCellInventoryDragState(app, nativeEvent);
    const targetPosition = getCellInventoryGridPositionFromEvent(
      event.currentTarget,
      nativeEvent,
      scopeContext.layoutState.gridDimensions,
      dragSize
    );
    const placementState = getCellInventoryPlacementState(scopeContext.layoutState, targetPosition, dragSize, ignoredIds);
    if (nativeEvent.dataTransfer) nativeEvent.dataTransfer.dropEffect = placementState.isValid ? 'move' : 'none';
    setCellInventoryDragTarget(host, placementState.position, dragSize, placementState.isValid, scopeContext.scopeRoot);
  });

  host.on('dragleave.cis-container-window', '.cis-cell-inventory-grid-stack', (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    clearCellInventoryDragState(host);
  });

  host.on('drop.cis-container-window', '.cis-cell-inventory-grid-stack', async (event) => {
    const nativeEvent = event.originalEvent ?? event;
    const { dropData, dragSize } = getCellInventoryDragState(app, nativeEvent, { readDropData: true });
    clearCellInventoryDragState(host);
    finishOwnedItemSheetDrag();
    if (!dropData || dropData.type !== 'Item') return;

    event.preventDefault();
    nativeEvent.preventDefault?.();
    event.stopImmediatePropagation();
    nativeEvent.stopImmediatePropagation?.();

    const scopeContext = getCellInventoryGridScopeContext(app, event.currentTarget);
    if (!scopeContext.layoutState || !scopeContext.containerId) return;

    const targetPosition = getCellInventoryGridPositionFromEvent(
      event.currentTarget,
      nativeEvent,
      scopeContext.layoutState.gridDimensions,
      dragSize
    );
    if (!targetPosition) return;

    const targetContainer = app.actor?.items?.get(scopeContext.containerId);
    if (!targetContainer) return;

    const droppedItem = await resolveDroppedItem(app, dropData);
    if (!droppedItem || droppedItem.id === targetContainer.id) return;

    await moveItemToContainer(app, droppedItem, targetContainer, {
      dropData,
      position: targetPosition
    });
  });
}

async function buildContainerCellInventoryPanel(app, containerItem) {
  const layoutState = collectContainerInventoryLayoutState(app.actor, containerItem);
  const grid = layoutState.gridDimensions;
  const capacity = await containerItem.system.computeCapacity();
  const slotsLabel = escapeHtml(localizeSafe('CUSTOM_SECTIONS.ContainerSlots', 'Slots'));
  const volumeLabel = escapeHtml(localizeSafe('CUSTOM_SECTIONS.ContainerVolumeShort', 'Volume'));
  const usedSlots = getContainerUsedSlotCount(layoutState.items);
  const totalSlots = grid.columns * grid.rows;
  const overflowHtml = layoutState.overflow.length
    ? `<div class="cis-cell-inventory-overflow">${escapeHtml(formatLocalizeSafe(
        'CUSTOM_SECTIONS.CellInventory.Overflow',
        { count: layoutState.overflow.length },
        `Overflow: ${layoutState.overflow.length}`
      ))}</div>`
    : '';

  const $panel = $(`
    <section
      class="cis-container-contents card cis-cell-inventory-scope cis-cell-inventory-container-scope"
      data-scope-type="container"
      data-container-id="${containerItem.id}"
    >
      <div class="cis-container-header">
        <h4><i class="fa-solid fa-box-open"></i> ${escapeHtml(containerItem.name)}</h4>
        <div class="spacer"></div>
        <div class="hint">${getContainerCapacityHint(containerItem, capacity)}</div>
      </div>
      <div class="cis-container-grid-meta">
        <span>${slotsLabel}: ${usedSlots} / ${totalSlots}</span>
        <span>${volumeLabel}: ${grid.columns} x ${grid.rows}</span>
      </div>
      <div class="cis-cell-inventory-panel-scroll">
        ${createCellInventoryGridMarkup(layoutState, { containerId: containerItem.id })}
      </div>
      ${overflowHtml}
    </section>
  `);

  $panel.find('.item-tooltip').each((_, element) => applyItemTooltips(element, app));
  return $panel;
}

async function buildContainerContentsPanel(app, containerItem) {
  const gridOn = isIconGridInventoryEnabled() || isCellInventoryEnabled();
  const contents = await resolveMaybePromise(containerItem.system.contents);
  const items = Array.from(contents?.values?.() ?? []).filter((item) => !shouldHideItemFromCellInventory(item));

  const byGroup = new Map();
  for (const it of items) {
    const custom = it.getFlag(MODULE_ID, FLAGS.SECTION);
    const groupName = (typeof custom === 'string' && custom.trim()) ? custom.trim() : (CONFIG.Item?.typeLabels?.[it.type] || it.type);
    if (!byGroup.has(groupName)) byGroup.set(groupName, []);
    byGroup.get(groupName).push(it);
  }
  const groupNames = Array.from(byGroup.keys()).sort((a, b) => a.localeCompare(b, game.i18n.lang));
  for (const name of groupNames) byGroup.get(name).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

  // Заголовок контейнера + емкость
  // Вычисляем текущую загрузку контейнера через системный метод
  const capacity = await containerItem.system.computeCapacity(); // { value, max, pct, units }
  const capacityLabel = game.i18n.localize(CONFIG.DND5E.itemCapacityTypes?.[containerItem.system.capacity?.type || 'weight'] ?? '');

  const $panel = $(`
    <div class="cis-container-contents card" data-container-id="${containerItem.id}">
      <div class="cis-container-header">
        <h4><i class="fa-solid fa-box-open"></i> ${containerItem.name}</h4>
        <div class="spacer"></div>
        <div class="hint">${capacityLabel}: ${Math.round(capacity.value * 100) / 100} / ${Number.isFinite(capacity.max) ? capacity.max : '&infin;'} ${capacity.units}</div>
      </div>
      <div class="cis-container-body"></div>
    </div>
  `);
  const body = $panel.find('.cis-container-body');
  for (const groupName of groupNames) {
    const itemsInGroup = byGroup.get(groupName);
    const localizedGroup = groupName.startsWith('TYPES.Item.')
      ? game.i18n.localize(groupName)
      : groupName;
    const $group = $(`
      <div class="cis-container-group" data-group-name="${localizedGroup}">
        <div class="cis-container-group-header"><h5>${localizedGroup}</h5></div>
        <ol class="item-list unlist ${gridOn ? 'cis-grid-list' : ''}"></ol>
      </div>
    `);
    const list = $group.find('ol');
    for (const it of itemsInGroup) {
      const qty = Number(it.system.quantity ?? 1);
      const htmlStr = gridOn
        ? createInventoryGridItemHtml(it, {}, qty)
        : createInventoryItemHtml(it, {}, false, qty, it.system.price?.value || 0, it.system.weight || 0, { editable: app.options.editable, owner: app.actor.isOwner });
      list.append(htmlStr);
    }
    body.append($group);
  }
  if (items.length === 0) body.append(`<div class="cis-container-empty">${localizeSafe('DND5E.Empty', undefined)}</div>`);

  // Тултипы и DnD внутри панели
  $panel.find('.item-tooltip').each((_, el) => applyItemTooltips(el, app));
  wireItemDragDrop(app, $panel.find('.item[data-item-id]'));

  // Drop внутрь панели — положить в контейнер (с запросом количества для стаков)
  const panelEl = $panel[0];
  panelEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  });
  panelEl.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
        try {
          const dropData = JSON.parse(event.dataTransfer.getData('text/plain'));
      const dropped = await resolveDroppedItem(app, dropData);
      if (!dropped) return;
      await moveItemToContainer(app, dropped, containerItem, dropData);
      // После изменения содержимого — восстановить представление контейнера в текущем режиме инвентаря
      const currentHtml = app.element instanceof jQuery ? app.element : $(app.element);
      if (isCellInventoryEnabled()) applyCellInventory(app, currentHtml);
      else restoreExpandedContainers(app, currentHtml);
    } catch (err) { /* ignore */ }
  });

  return $panel;
}

// Восстановление ранее раскрытых контейнеров
function restoreExpandedContainers(app, html) {
  const expanded = getExpandedContainersForActor(app.actor.id);
  if (!expanded || expanded.size === 0) return;
  for (const containerId of expanded) {
    const li = html[0]?.querySelector(`[data-custom-section] .item[data-item-id="${containerId}"]`);
    const container = app.actor.items.get(containerId);
    if (!li || container?.type !== 'container') continue;

    // Удаляем возможные прежние панели в DOM для чистоты
    const $li = $(li);
    if ($li.next().hasClass('cis-container-contents')) $li.next('.cis-container-contents').remove();
    if ($li.parent().hasClass('cis-grid-row')) $li.parent().children('.cis-container-contents').remove();

    buildContainerContentsPanel(app, container).then(panel => {
      if ($li.hasClass('cis-grid-item')) {
        // Если уже есть обертка строки, просто добавим панель внутрь
        if ($li.parent().hasClass('cis-grid-row')) {
          $li.parent()[0].appendChild(panel[0]);
        } else {
          const wrapper = document.createElement('div');
          wrapper.className = 'cis-grid-row';
          wrapper.style.display = 'flex';
          wrapper.style.gap = '8px';
          wrapper.style.alignItems = 'flex-start';
          $li.replaceWith(wrapper);
          wrapper.appendChild(li);
          wrapper.appendChild(panel[0]);
        }
      } else {
        $li.after(panel);
        }
      });
    }
}

async function resolveMaybePromise(value) {
  if (value && typeof value.then === 'function') return await value;
  return value;
}

async function resolveDroppedItem(app, dropData) {
  try {
    if (dropData?.type === 'Item' && dropData.actorId === app.actor.id && dropData.id) {
      return app.actor.items.get(dropData.id);
    }
    if (dropData?.uuid) {
      const doc = await fromUuid(dropData.uuid);
      if (doc?.documentName === 'Item') return doc;
      if (doc?.constructor?.documentName === 'Item') return doc;
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | resolveDroppedItem failed`, e);
  }
  return null;
}

async function _legacyMoveItemToContainer(app, droppedItem, containerItem, dropData = null) {
  // Сколько переносить?
  const qty = Number(droppedItem.system?.quantity ?? 1);
  // Проверка категорий
  if (!isItemAllowedByCategory(containerItem, droppedItem)) {
    ui.notifications?.warn?.(game.i18n.localize('CUSTOM_SECTIONS.CategoryReject'));
    return;
  }
  // Ограничение вместимости
  let maxFit = await computeMaxFittableQuantity(containerItem, droppedItem);
  if (maxFit <= 0) {
    ui.notifications?.warn?.(game.i18n.localize('CUSTOM_SECTIONS.CapacityExceeded'));
    return;
  }
  let amount = Math.min(qty, maxFit);
  if (qty > 1) amount = await promptForQuantity({ title: droppedItem.name, max: maxFit });
  if (!amount || amount < 1) return;

  if (droppedItem?.parent === app.actor) {
    const sourceItem = await normalizePaperDollDraggedItem(app, droppedItem, dropData);
    const sourceQty = Number(sourceItem.system?.quantity ?? 1);
    // Перенос внутри одного актера: если переносим часть стака — разделяем
    if (amount < sourceQty) {
      // Попробуем слить со стеком в целевом контейнере
      const mergeTarget = findMergeTarget(app.actor, sourceItem, containerItem.id);
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
        await sourceItem.update({ 'system.quantity': sourceQty - amount });
      } else {
        const newData = foundry.utils.duplicate(sourceItem.toObject());
        newData.system.quantity = amount;
        newData.system.container = containerItem.id;
        await app.actor.createEmbeddedDocuments('Item', [newData]);
        await sourceItem.update({ 'system.quantity': sourceQty - amount });
      }
    } else {
      // Переносим весь стек: если есть цель для слияния — сливаем и удаляем исходный
      const mergeTarget = findMergeTarget(app.actor, sourceItem, containerItem.id);
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + sourceQty });
        await sourceItem.delete();
      } else {
        await sourceItem.update({ 'system.container': containerItem.id });
      }
    }
    return;
  }

  // Перенос из внешнего источника: создаем копию с нужным количеством
  const data = droppedItem?.toObject ? droppedItem.toObject() : droppedItem;
  if (!data) return;
  data.system = data.system ?? {};
  data.system.quantity = amount;
  // Слияние с существующим стеком в контейнере
  const mergeTarget = findMergeTarget(app.actor, data, containerItem.id);
  if (mergeTarget) {
    await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
  } else {
    foundry.utils.setProperty(data, 'system.container', containerItem.id);
    await app.actor.createEmbeddedDocuments('Item', [data]);
  }
}

function normalizeMoveItemToContainerOptions(options = null) {
  if (options && typeof options === 'object' && !Array.isArray(options) && (
    'dropData' in options
    || 'position' in options
    || 'amount' in options
    || 'skipQuantityPrompt' in options
    || 'suppressNotifications' in options
  )) {
    return {
      dropData: options.dropData ?? null,
      position: options.position ?? null,
      amount: Number.isFinite(Number(options.amount)) ? Math.max(1, Math.floor(Number(options.amount))) : null,
      skipQuantityPrompt: options.skipQuantityPrompt === true,
      suppressNotifications: options.suppressNotifications === true
    };
  }

  return {
    dropData: options ?? null,
    position: null,
    amount: null,
    skipQuantityPrompt: false,
    suppressNotifications: false
  };
}

async function moveItemToContainer(app, droppedItem, containerItem, options = null) {
  const {
    dropData = null,
    position = null,
    amount: requestedAmount = null,
    skipQuantityPrompt = false,
    suppressNotifications = false
  } = normalizeMoveItemToContainerOptions(options);
  const isSameActorItem = droppedItem?.parent === app.actor;
  const isPaperDollDrop = isPaperDollSourceDropData(dropData) || isPaperDollInventoryHidden(droppedItem);
  const isRepositionInSameContainer = isSameActorItem && (droppedItem.system?.container === containerItem.id);

  if (isRepositionInSameContainer) {
    if (!position) return false;
    const sourceItem = isPaperDollDrop
      ? await normalizePaperDollDraggedItem(app, droppedItem, dropData, { cisSkipAutoUnequipPlacement: true })
      : droppedItem;
    const layoutState = collectContainerInventoryLayoutState(app.actor, containerItem);
    const placementState = getCellInventoryPlacementState(
      layoutState,
      position,
      getCellInventorySize(sourceItem),
      new Set([sourceItem.id]),
      layoutState.gridDimensions
    );
    if (!placementState.isValid) {
      if (!suppressNotifications) ui.notifications?.warn?.(game.i18n.localize('CUSTOM_SECTIONS.SlotCapacityExceeded'));
      return false;
    }
    await sourceItem.update({
      [`flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`]: placementState.position
    }, {
      cisSkipAutoUnequipPlacement: true
    });
    return true;
  }

  const qty = Number(droppedItem.system?.quantity ?? 1);
  if (!isItemAllowedByCategory(containerItem, droppedItem)) {
    if (!suppressNotifications) ui.notifications?.warn?.(game.i18n.localize('CUSTOM_SECTIONS.CategoryReject'));
    return false;
  }

  const fitState = await computeMaxFittableQuantity(containerItem, droppedItem, {
    preferredPosition: position,
    actor: app.actor
  });
  if (fitState.maxQuantity <= 0) {
    const reasonKey = fitState.reason === 'slots'
      ? 'CUSTOM_SECTIONS.SlotCapacityExceeded'
      : 'CUSTOM_SECTIONS.CapacityExceeded';
    if (!suppressNotifications) ui.notifications?.warn?.(game.i18n.localize(reasonKey));
    return false;
  }

  let amount = requestedAmount ?? Math.min(qty, fitState.maxQuantity);
  if (amount > fitState.maxQuantity) {
    const reasonKey = fitState.reason === 'slots'
      ? 'CUSTOM_SECTIONS.SlotCapacityExceeded'
      : 'CUSTOM_SECTIONS.CapacityExceeded';
    if (!suppressNotifications) ui.notifications?.warn?.(game.i18n.localize(reasonKey));
    return false;
  }
  if (requestedAmount == null && qty > 1 && !skipQuantityPrompt) {
    amount = await promptForQuantity({ title: droppedItem.name, max: fitState.maxQuantity });
  }
  if (!amount || amount < 1) return false;

  if (isSameActorItem) {
    const sourceItem = await normalizePaperDollDraggedItem(app, droppedItem, dropData, {
      cisSkipAutoUnequipPlacement: true
    });
    const sourceQty = Number(sourceItem.system?.quantity ?? 1);
    const mergeTarget = findMergeTarget(app.actor, sourceItem, containerItem.id);

    if (amount < sourceQty) {
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
        await sourceItem.update({ 'system.quantity': sourceQty - amount });
      } else {
        const newData = foundry.utils.duplicate(sourceItem.toObject());
        newData.system.quantity = amount;
        newData.system.container = containerItem.id;
        foundry.utils.setProperty(newData, `flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`, fitState.position);
        await app.actor.createEmbeddedDocuments('Item', [newData]);
        await sourceItem.update({ 'system.quantity': sourceQty - amount });
      }
    } else if (mergeTarget) {
      await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + sourceQty });
      await sourceItem.delete();
    } else {
      await sourceItem.update({
        'system.container': containerItem.id,
        [`flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`]: fitState.position
      });
    }
    return true;
  }

  const data = droppedItem?.toObject ? droppedItem.toObject() : droppedItem;
  if (!data) return false;
  data.system = data.system ?? {};
  data.system.quantity = amount;

  const mergeTarget = findMergeTarget(app.actor, data, containerItem.id);
  if (mergeTarget) {
    await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
  } else {
    foundry.utils.setProperty(data, 'system.container', containerItem.id);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAGS.GRID_POSITION}`, fitState.position);
    await app.actor.createEmbeddedDocuments('Item', [data]);
  }
  return true;
}

function normalizeMoveItemToRootOptions(options = null) {
  if (options && typeof options === 'object' && !Array.isArray(options) && (
    'dropData' in options
    || 'amount' in options
    || 'skipQuantityPrompt' in options
    || 'suppressNotifications' in options
  )) {
    return {
      dropData: options.dropData ?? null,
      amount: Number.isFinite(Number(options.amount)) ? Math.max(1, Math.floor(Number(options.amount))) : null,
      skipQuantityPrompt: options.skipQuantityPrompt === true,
      suppressNotifications: options.suppressNotifications === true
    };
  }

  return {
    dropData: options ?? null,
    amount: null,
    skipQuantityPrompt: false,
    suppressNotifications: false
  };
}

async function moveItemToRoot(app, droppedItem, options = null) {
  const {
    dropData = null,
    amount: requestedAmount = null,
    skipQuantityPrompt = false
  } = normalizeMoveItemToRootOptions(options);
  const normalizedItem = await normalizePaperDollDraggedItem(app, droppedItem, dropData, {
    cisSkipAutoUnequipPlacement: true
  });
  const qty = Number(normalizedItem.system?.quantity ?? 1);
  let amount = requestedAmount ?? qty;
  if (amount > qty) amount = qty;
  if (requestedAmount == null && qty > 1 && !skipQuantityPrompt) {
    amount = await promptForQuantity({ title: normalizedItem.name, max: qty });
  }
  if (!amount || amount < 1) return false;

  if (normalizedItem?.parent === app.actor) {
    const mergeTarget = findMergeTarget(app.actor, normalizedItem, null);
    if (amount < qty) {
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
        await normalizedItem.update({ 'system.quantity': qty - amount });
      } else {
        const newData = foundry.utils.duplicate(normalizedItem.toObject());
        newData.system.quantity = amount;
        newData.system.container = null;
        await app.actor.createEmbeddedDocuments('Item', [newData]);
        await normalizedItem.update({ 'system.quantity': qty - amount });
      }
    } else {
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + qty });
        await normalizedItem.delete();
      } else {
        await normalizedItem.update({ 'system.container': null });
      }
    }
    return true;
  }

  const data = normalizedItem?.toObject ? normalizedItem.toObject() : normalizedItem;
  if (!data) return false;
  data.system = data.system ?? {};
  data.system.quantity = amount;
  const mergeTarget = findMergeTarget(app.actor, data, null);
  if (mergeTarget) {
    await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
  } else {
    foundry.utils.setProperty(data, 'system.container', null);
    await app.actor.createEmbeddedDocuments('Item', [data]);
  }
  return true;
}

// Поиск подходящего стека для слияния в указанной локации (containerId или null)
function findMergeTarget(actor, sourceItemLike, containerId) {
  if (isNonStackableItemLike(sourceItemLike)) return null;
  const key = getMergeKey(sourceItemLike);
  return actor.items.find(i => (i.system?.container ?? null) === (containerId ?? null)
    && i.id !== sourceItemLike.id
    && !shouldHideItemFromCellInventory(i)
    && !isNonStackableItemLike(i)
    && getMergeKey(i) === key);
}

function getMergeKey(itemLike) {
  const sys = itemLike.system ?? {};
  const subtype = sys.baseItem ?? sys.type?.value ?? '';
  const rarity = sys.rarity ?? '';
  const ammoType = sys.ammoType ?? '';
  const cellSize = getCellInventorySize(itemLike);
  return [itemLike.type, itemLike.name, itemLike.img, subtype, rarity, ammoType, cellSize.width, cellSize.height].join('|');
}

function isNonStackableItemLike(itemLike) {
  const localFlag = foundry.utils.getProperty(itemLike, `flags.${MODULE_ID}.${FLAGS.NON_STACKABLE}`);
  if (isTruthyFlagValue(localFlag)) return true;

  try {
    const checker = game?.blok?.UniqueCodeHandler?._isNonStackableItem;
    if (typeof checker === 'function') return !!checker(itemLike);
  } catch (_) { /* ignore */ }

  return false;
}

function isTruthyFlagValue(value) {
  if (value === true) return true;
  if (value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'on' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

// Диалог запроса количества для перемещения стека
async function promptForQuantity({ title = '', max = 1 } = {}) {
  return new Promise((resolve) => {
    const content = `
      <form class="cis-qty-dialog">
        <div class="form-group">
          <label>${game.i18n.localize('DND5E.Quantity')}</label>
          <input type="number" name="qty" min="1" max="${max}" value="${max}" style="width: 5rem;" />
        </div>
        <div class="form-group">
          <input type="range" name="qty-range" min="1" max="${max}" step="1" value="${max}" />
        </div>
      </form>
    `;
    const titleText = `${game.i18n.localize('CUSTOM_SECTIONS.SplitQuantity')}: ${title}`;
    new Dialog({
      title: titleText,
      content,
      buttons: {
        ok: {
          label: game.i18n.localize('OK'),
          callback: (html) => {
            const val = Number(html.find('input[name="qty"]').val());
            const clamped = Math.max(1, Math.min(max, Math.floor(val || 0)));
            resolve(clamped);
          }
        },
        all: {
          label: game.i18n.localize('CUSTOM_SECTIONS.All'),
          callback: () => resolve(max)
        },
        cancel: { label: game.i18n.localize('Cancel'), callback: () => resolve(0) }
      },
      default: 'ok',
      render: (html) => {
        const $num = html.find('input[name="qty"]');
        const $rng = html.find('input[name="qty-range"]');
        const sync = (val) => {
          const v = Math.max(1, Math.min(max, Math.floor(Number(val) || 0)));
          $num.val(v);
          $rng.val(v);
        };
        $rng.on('input change', () => sync($rng.val()));
        $num.on('input change', () => sync($num.val()));
      }
    }).render(true);
  });
}

// Логирование для отладки
Hooks.once('ready', () => {
  logDebug('Модуль Custom Item Sections готов к работе');
  
  // Проверяем, что система dnd5e
  if (game.system.id !== 'dnd5e') {
    console.warn(`${MODULE_ID} | Модуль предназначен для системы D&D 5e, текущая система: ${game.system.id}`);
  }

  // На всякий случай дублируем установку патча
  try { installContainerWeightReductionPatch(); } catch (_) {}
}); 

// Патч геттера totalWeight для контейнеров: применяет % снижения нагрузки к содержимому
function installContainerWeightReductionPatch() {
  const ContainerData = CONFIG?.Item?.dataModels?.container || globalThis?.dnd5e?.dataModels?.item?.ContainerData;
  const proto = ContainerData?.prototype;
  if (!proto) return;
  if (proto.__cisWeightReductionPatched) return;

  const originalDescriptor = Object.getOwnPropertyDescriptor(proto, 'totalWeight');

  Object.defineProperty(proto, 'totalWeight', {
    configurable: true,
    get: function totalWeightWithReduction() {
      try {
        // Если содержимое без веса — используем нативную логику
        if (this.properties?.has?.('weightlessContents')) return this.weight?.value ?? 0;

        // Текущее значение снижения в процентах (флаг предмета-контейнера)
        const percent = Number(this.parent?.getFlag?.(MODULE_ID, FLAGS.WEIGHT_REDUCTION) ?? 0) || 0;
        const clamped = Math.max(0, Math.min(100, percent));
        // Работает только если контейнер надет (equipped). Иначе коэффициент 1.
        const equipped = Boolean(this.parent?.system?.equipped);
        const factor = equipped ? (1 - (clamped / 100)) : 1;

        const contained = this.contentsWeight;
        if (contained instanceof Promise) {
          return contained.then(cw => (this.weight?.value ?? 0) + (cw * factor));
        }
        return (this.weight?.value ?? 0) + (contained * factor);
      } catch (e) {
        // В случае ошибки — откат к оригинальному поведению
        if (originalDescriptor?.get) {
          try { return originalDescriptor.get.call(this); } catch (_) { /* ignore */ }
        }
        return (this.weight?.value ?? 0) + (Number(this.contentsWeight) || 0);
      }
    }
  });

  Object.defineProperty(proto, '__cisWeightReductionPatched', { value: true, enumerable: false });
  logDebug('Container weight reduction patch installed');
}

// --- Вспомогательные: правила ограничения категорий и вместимости --- //

function getContainerCategoryRule(containerItem) {
  const mode = containerItem.getFlag(MODULE_ID, FLAGS.CATEGORY_MODE) || 'allow';
  const list = Array.isArray(containerItem.getFlag(MODULE_ID, FLAGS.CATEGORY_LIST))
    ? containerItem.getFlag(MODULE_ID, FLAGS.CATEGORY_LIST) : [];
  return { mode, list: list.map(v => String(v || '').trim().toLowerCase()).filter(Boolean) };
}

function isItemAllowedByCategory(containerItem, itemLike) {
  const { mode, list } = getContainerCategoryRule(containerItem);
  if (!list.length) return true; // Пустой список = без ограничений
  const section = String(itemLike.getFlag?.(MODULE_ID, FLAGS.SECTION) || '').trim().toLowerCase();
  const inList = list.includes(section);
  return mode === 'deny' ? !inList : inList; // deny = все, кроме перечисленных; allow = только перечисленные
}

async function _legacyComputeMaxFittableQuantity(containerItem, itemLike) {
  try {
    const capacity = containerItem.system?.capacity;
    if (!capacity) return Number(itemLike.system?.quantity ?? 1);
    const max = Number(capacity.value ?? Infinity);
    if (!Number.isFinite(max)) return Number(itemLike.system?.quantity ?? 1);

    if (capacity.type === 'items') {
      const current = await containerItem.system.contentsCount;
      const remaining = Math.max(0, Math.floor(max - current));
      const qty = Number(itemLike.system?.quantity ?? 1);
      return Math.max(0, Math.min(remaining, qty));
    }

    // type === 'weight'
    const units = containerItem.system.weight?.units || (game.settings.get('dnd5e', 'metricWeightUnits') ? 'kg' : 'lb');
    const current = await containerItem.system.contentsWeight; // без снижения
    const remainingWeight = Math.max(0, (max - current));
    const totalItemWeight = itemLike.system?.totalWeightIn?.(units) ?? 0;
    const qty = Math.max(1, Number(itemLike.system?.quantity ?? 1));
    const perUnit = qty > 0 ? (totalItemWeight / qty) : totalItemWeight;
    if (perUnit <= 0) return qty; // Безвесомые предметы
    return Math.max(0, Math.min(qty, Math.floor(remainingWeight / perUnit)));
  } catch (e) {
    console.warn(`${MODULE_ID} | computeMaxFittableQuantity failed`, e);
    return Number(itemLike.system?.quantity ?? 1);
  }
}

function doesCellInventorySizeFitGrid(size, gridDimensions = CELL_INVENTORY) {
  const grid = getCellInventoryGridDimensions(gridDimensions);
  return size.width <= grid.columns && size.height <= grid.rows;
}

function resolveContainerGridPlacement(actor, containerItem, itemLike, {
  preferredPosition = null,
  ignoredIds = new Set()
} = {}) {
  const gridDimensions = getContainerGridLayout(containerItem);
  const size = getCellInventorySize(itemLike);
  if (!doesCellInventorySizeFitGrid(size, gridDimensions)) {
    return { position: null, reason: 'slots', gridDimensions };
  }

  const layoutState = collectContainerInventoryLayoutState(actor, containerItem);
  if (preferredPosition) {
    const preferredPlacement = getCellInventoryPlacementState(
      layoutState,
      preferredPosition,
      size,
      ignoredIds,
      gridDimensions
    );
    if (preferredPlacement.isValid) {
      return { position: preferredPlacement.position, reason: null, gridDimensions, layoutState };
    }
    return { position: null, reason: 'slots', gridDimensions, layoutState };
  }

  const autoPosition = findNextFreeCellInventoryPosition(layoutState.occupiedCells, size, gridDimensions);
  return {
    position: autoPosition,
    reason: autoPosition ? null : 'slots',
    gridDimensions,
    layoutState
  };
}

async function computeMaxFittableQuantity(containerItem, itemLike, options = {}) {
  const actor = options.actor ?? containerItem?.parent ?? null;
  try {
    const qty = Math.max(1, Number(itemLike.system?.quantity ?? 1));
    const capacity = containerItem.system?.capacity;
    let maxQuantity = qty;

    if (capacity) {
      const max = Number(capacity.value ?? Infinity);
      if (Number.isFinite(max)) {
        if (capacity.type === 'items') {
          const current = await containerItem.system.contentsCount;
          const remaining = Math.max(0, Math.floor(max - current));
          maxQuantity = Math.max(0, Math.min(remaining, qty));
        } else {
          const units = containerItem.system.weight?.units || (game.settings.get('dnd5e', 'metricWeightUnits') ? 'kg' : 'lb');
          const current = await containerItem.system.contentsWeight;
          const remainingWeight = Math.max(0, (max - current));
          const totalItemWeight = itemLike.system?.totalWeightIn?.(units) ?? 0;
          const perUnit = qty > 0 ? (totalItemWeight / qty) : totalItemWeight;
          maxQuantity = perUnit <= 0
            ? qty
            : Math.max(0, Math.min(qty, Math.floor(remainingWeight / perUnit)));
        }
      }
    }

    if (maxQuantity <= 0) {
      return { maxQuantity: 0, reason: 'capacity', position: null, mergeTarget: null };
    }

    const mergeTarget = actor ? findMergeTarget(actor, itemLike, containerItem.id) : null;
    if (mergeTarget) {
      return {
        maxQuantity,
        reason: null,
        position: getStoredCellInventoryPosition(mergeTarget, actor?.id ?? null, getContainerGridLayout(containerItem)),
        mergeTarget
      };
    }

    const placement = resolveContainerGridPlacement(actor, containerItem, itemLike, {
      preferredPosition: options.preferredPosition ?? null,
      ignoredIds: options.ignoredIds ?? new Set()
    });
    if (!placement.position) {
      return {
        maxQuantity: 0,
        reason: placement.reason ?? 'slots',
        position: null,
        mergeTarget: null
      };
    }

    return {
      maxQuantity,
      reason: null,
      position: placement.position,
      mergeTarget: null
    };
  } catch (e) {
    console.warn(`${MODULE_ID} | computeMaxFittableQuantity failed`, e);
    return {
      maxQuantity: Number(itemLike.system?.quantity ?? 1),
      reason: null,
      position: null,
      mergeTarget: null
    };
  }
}

export {
  applyCellInventory,
  applyItemTooltips,
  beginOwnedItemSheetDrag,
  finishOwnedItemSheetDrag
};
