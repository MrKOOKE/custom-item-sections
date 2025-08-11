// Константы модуля
const MODULE_ID = 'custom-item-sections';
const FLAGS = {
  SECTION: 'section'
};

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
const wiredDropZones = new WeakSet();

function getExpandedContainersForActor(actorId) {
  if (!expandedContainersByActor.has(actorId)) expandedContainersByActor.set(actorId, new Set());
  return expandedContainersByActor.get(actorId);
}

// Инициализация модуля
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Инициализация модуля Custom Item Sections`);
  
  // Регистрируем настройки, если необходимо
  registerSettings();
  
  // Добавляем глобальные обработчики для блокировки редактирования количества
  setupInventoryControlHandlers();

  // Стабилизация прокрутки листов актёров DnD5e, чтобы окно не "дёргалось" при переносе предметов
  installScrollStabilizer();
});

// Функция настройки обработчиков контроля инвентаря
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
  game.settings.register(MODULE_ID, 'enableGridInventory', {
    name: 'CUSTOM_SECTIONS.Settings.EnableGridInventory.Name',
    hint: 'CUSTOM_SECTIONS.Settings.EnableGridInventory.Hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });
}

// Устанавливает стабилизацию прокрутки листов актёров, оборачивая их _render
function installScrollStabilizer() {
  // Только для системы dnd5e
  if (game.system?.id !== 'dnd5e') return;

  // Обёртка, сохраняющая и восстанавливающая scrollTop для ключевых контейнеров
  const wrapImpl = function(inner) {
    return async function(force, options) {
      try {
        // Сохраняем текущие позиции прокрутки
        const rootBefore = this?.element?.[0] ?? null;
        const configured = Array.isArray(this?.options?.scrollY) ? this.options.scrollY : [];
        const extraSelectors = [
          // На случай старых/новых листов и разных разметок
          '.items-list',
          '.inventory-list',
          '.effects-list',
          'dnd5e-inventory .inventory-list',
          'dnd5e-effects .effects-list',
          '.center-pane',
          '.sheet-body'
        ];
        const selectors = Array.from(new Set([...configured, ...extraSelectors]));
        const saved = new Map();
        if (rootBefore && selectors.length) {
          for (const selector of selectors) {
            const scroller = rootBefore.querySelector(selector);
            if (scroller && typeof scroller.scrollTop === 'number') {
              saved.set(selector, scroller.scrollTop);
            }
          }
        }

        // Рендер по-обычному
        const result = await inner.call(this, force, options);

        // Восстанавливаем прокрутку на новом DOM
        const rootAfter = this?.element?.[0] ?? null;
        if (rootAfter && saved.size) {
          const applyScroll = () => {
            for (const [selector, top] of saved) {
              const scroller = rootAfter.querySelector(selector);
              if (scroller && typeof top === 'number') scroller.scrollTop = top;
            }
          };
          // Сейчас, на следующий кадр и микротаск — чтобы перекрыть поздние сдвиги верстки
          applyScroll();
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyScroll);
          setTimeout(applyScroll, 0);
        }

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
      console.log(`${MODULE_ID} | Scroll stabilizer installed via libWrapper`);
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
    console.log(`${MODULE_ID} | Scroll stabilizer installed (fallback)`);
  }
}

// Добавляем поле Section в листы предметов
Hooks.on('renderItemSheet', async (app, html, data) => {
  // Проверяем, включен ли модуль и это лист предмета dnd5e
  if (!game.settings.get(MODULE_ID, 'enableCustomSections')) return;
  if (game.system.id !== 'dnd5e') return;

  console.log(`${MODULE_ID} | Adding section field to item ${app.object.name}`);

  // Получаем текущее значение section из флагов
  const section = app.object.getFlag(MODULE_ID, FLAGS.SECTION) || '';
  
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
  `;
  
  // Добавляем поле в начало вкладки Details или в конец формы
  if (detailsTab.length) {
    console.log(`${MODULE_ID} | Found details tab, adding field after form header`);
    // Ищем первый form-header и вставляем после него
    const formHeader = detailsTab.find('.form-header').first();
    if (formHeader.length) {
      formHeader.after(sectionFieldHtml);
    } else {
      detailsTab.prepend(sectionFieldHtml);
    }
  } else {
    console.log(`${MODULE_ID} | No details tab found, adding to alternative location`);
    // Альтернативное размещение для других типов предметов
    const formGroups = targetElement.find('.form-group');
    if (formGroups.length) {
      formGroups.first().before(sectionFieldHtml);
    } else {
      targetElement.prepend(sectionFieldHtml);
    }
  }
  
  // Устанавливаем высоту приложения для корректного отображения
  app.setPosition(app.position);
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
  
  console.log(`${MODULE_ID} | Processing custom sections for actor ${app.actor.name}`);
  console.log(`${MODULE_ID} | Sheet class: ${app.constructor.name}`);
  
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

  // Применяем сетчатый вид к стандартным секциям, если включено в настройках
  applyGridInventory(app, html);

  // Восстанавливаем ранее раскрытые контейнеры
  restoreExpandedContainers(app, html);
}

// Преобразуем стандартные секции dnd5e инвентаря в сетку (без названий), если включено
function applyGridInventory(app, html) {
  const gridOn = game.settings.get(MODULE_ID, 'enableGridInventory');
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
    await item.use();
  });

  // DnD: делегированные обработчики для стандартных секций (сеточные плитки)
  inventoryTabs.off('dragstart.cis-grid dragend.cis-grid dragover.cis-grid drop.cis-grid');
  inventoryTabs.on('dragstart.cis-grid', '.cis-grid-item', (event) => {
    const li = event.currentTarget.closest('.item');
    if (!li) return;
    const itemId = li.dataset.itemId;
    const item = app.actor.items.get(itemId);
    if (!item) return;
    const dragData = { type: 'Item', id: item.id, uuid: item.uuid, actorId: app.actor.id, actorUuid: app.actor.uuid };
    if (event.originalEvent?.dataTransfer) {
      event.originalEvent.dataTransfer.setData('text/plain', JSON.stringify(dragData));
      event.originalEvent.dataTransfer.effectAllowed = 'copyMove';
    }
    if (event.originalEvent?.dataTransfer) event.originalEvent.dataTransfer.effectAllowed = 'copyMove';
    li.classList.add('dragging');
  });
  inventoryTabs.on('dragend.cis-grid', '.cis-grid-item', (event) => {
    const li = event.currentTarget.closest('.item');
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
        await moveItemToContainer(app, dropped, targetItem);
      } else {
        await moveItemToRoot(app, dropped);
      }
    } catch (e) {
      console.error(`${MODULE_ID} | drop.cis-grid error`, e);
    }
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
    const customSectionName = item.getFlag(MODULE_ID, FLAGS.SECTION);
    const itemTab = getItemTab(item);
    
    // Проверяем, что customSectionName является строкой и не пустая после trim
    if (customSectionName && typeof customSectionName === 'string' && customSectionName.trim()) {
      console.log(`${MODULE_ID} | Found item "${item.name}" with custom section "${customSectionName}" in tab "${itemTab}"`);
      
      if (!tabSections[itemTab].has(customSectionName)) {
        tabSections[itemTab].set(customSectionName, []);
      }
      tabSections[itemTab].get(customSectionName).push(item);
    }
  });
  
  // Обрабатываем каждую вкладку
  Object.entries(tabSections).forEach(([tabName, customSections]) => {
    if (customSections.size === 0) return;
    
    console.log(`${MODULE_ID} | Processing ${customSections.size} custom sections for tab "${tabName}"`);
    
    // Находим контейнер для соответствующей вкладки
    const tabContainer = findTabContainer(html, tabName);
    if (!tabContainer) {
      console.log(`${MODULE_ID} | Tab container not found for "${tabName}"`);
      return;
    }
    
    // Удаляем предметы с кастомными секциями из стандартных секций
    customSections.forEach((items, sectionName) => {
      items.forEach(item => {
        const itemElement = html.find(`[data-item-id="${item.id}"]`);
        if (itemElement.length) {
          console.log(`${MODULE_ID} | Removing item "${item.name}" from standard section in tab "${tabName}"`);
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
        console.log(`${MODULE_ID} | Hiding empty section: ${section.find('.item-name').text().trim()}`);
        section.hide();
      }
    });
    
    // Создаем кастомные секции
    const sortedSectionNames = Array.from(customSections.keys()).sort();
    
    sortedSectionNames.forEach(sectionName => {
      const items = customSections.get(sectionName);
      console.log(`${MODULE_ID} | Creating custom section "${sectionName}" with ${items.length} items in tab "${tabName}"`);
      
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
  const gridOn = game.settings.get(MODULE_ID, 'enableGridInventory');
  
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
      console.log(`${MODULE_ID} | Updating quantity for item ${item.name} to ${value}`);
      await item.update({ "system.quantity": value });
    }
  });
  
  // Обработчик для изменения использований
  html.find('[data-custom-section] input[data-name="system.uses.value"]').change(async (event) => {
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const value = Number(event.currentTarget.value);
    const item = app.actor.items.get(itemId);
    if (item) {
      console.log(`${MODULE_ID} | Updating uses for item ${item.name} to ${value}`);
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
      console.log(`${MODULE_ID} | ${action} quantity for item ${item.name} to ${newValue}`);
      await item.update({ [property]: newValue });
    }
  });
  
  // Обработчик для редактирования предмета
  html.find('[data-custom-section] [data-action="edit"]').click(async (event) => {
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const item = app.actor.items.get(itemId);
    if (item) {
      console.log(`${MODULE_ID} | Opening item sheet for ${item.name}`);
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
    await item.use();
  });
  
  // Обработчик для удаления предмета
  html.find('[data-custom-section] [data-action="delete"]').click(async (event) => {
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const item = app.actor.items.get(itemId);
    if (item) {
      console.log(`${MODULE_ID} | Attempting to delete item ${item.name}`);
      const confirmed = await Dialog.confirm({
        title: game.i18n.localize("DND5E.ItemDelete"),
        content: `<p>${game.i18n.format("DND5E.ItemDeleteConfirm", {item: item.name})}</p>`
      });
      if (confirmed) {
        await item.delete();
        console.log(`${MODULE_ID} | Deleted item ${item.name}`);
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
      console.log(`${MODULE_ID} | Toggling description for item ${item.name}, expanded: ${isExpanded}`);
      
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
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      inventoryRoot.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          const str = event.dataTransfer?.getData('text/plain');
          if (!str) return;
          const dropData = JSON.parse(str);
          const dropped = await resolveDroppedItem(app, dropData);
          if (!dropped) return;
          await moveItemToRoot(app, dropped);
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
        const dragData = {
          type: 'Item',
          id: item.id,
          uuid: item.uuid,
          actorId: app.actor.id,
          actorUuid: app.actor.uuid
        };
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copyMove';
      }
        $element.addClass('dragging');
      });
    element.addEventListener('dragend', () => $element.removeClass('dragging'));
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
          await moveItemToContainer(app, dropped, item);
          return;
        }
        await moveItemToRoot(app, dropped);
      } catch (error) {
        console.error(`${MODULE_ID} | Error processing drop:`, error);
      }
    });
  });
}

// Переключение экипировки с обновлением классов и подсветки
async function toggleEquip(item, liElement) {
  const equipped = Boolean(item.system?.equipped);
  await item.update({ 'system.equipped': !equipped });
  const li = liElement instanceof HTMLElement ? liElement : (liElement?.[0] ?? null);
  if (li) li.classList.toggle('equipped', !equipped);
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
async function buildContainerContentsPanel(app, containerItem) {
  const gridOn = game.settings.get(MODULE_ID, 'enableGridInventory');
  const contents = await resolveMaybePromise(containerItem.system.contents);
  const items = Array.from(contents?.values?.() ?? []);

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
      await moveItemToContainer(app, dropped, containerItem);
      // После изменения содержимого — восстановить обертку/панель, чтобы не уехало позиционирование
      restoreExpandedContainers(app, $(html[0] ?? app.element));
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

async function moveItemToContainer(app, droppedItem, containerItem) {
  // Сколько переносить?
  const qty = Number(droppedItem.system?.quantity ?? 1);
  let amount = qty;
  if (qty > 1) amount = await promptForQuantity({ title: droppedItem.name, max: qty });
  if (!amount || amount < 1) return;

  if (droppedItem?.parent === app.actor) {
    // Перенос внутри одного актера: если переносим часть стака — разделяем
    if (amount < qty) {
      // Попробуем слить со стеком в целевом контейнере
      const mergeTarget = findMergeTarget(app.actor, droppedItem, containerItem.id);
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
        await droppedItem.update({ 'system.quantity': qty - amount });
      } else {
        const newData = foundry.utils.duplicate(droppedItem.toObject());
        newData.system.quantity = amount;
        newData.system.container = containerItem.id;
        await app.actor.createEmbeddedDocuments('Item', [newData]);
        await droppedItem.update({ 'system.quantity': qty - amount });
      }
    } else {
      // Переносим весь стек: если есть цель для слияния — сливаем и удаляем исходный
      const mergeTarget = findMergeTarget(app.actor, droppedItem, containerItem.id);
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + qty });
        await droppedItem.delete();
      } else {
        await droppedItem.update({ 'system.container': containerItem.id });
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

async function moveItemToRoot(app, droppedItem) {
  const qty = Number(droppedItem.system?.quantity ?? 1);
  let amount = qty;
  if (qty > 1) amount = await promptForQuantity({ title: droppedItem.name, max: qty });
  if (!amount || amount < 1) return;

  if (droppedItem?.parent === app.actor) {
    const mergeTarget = findMergeTarget(app.actor, droppedItem, null);
    if (amount < qty) {
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
        await droppedItem.update({ 'system.quantity': qty - amount });
      } else {
        const newData = foundry.utils.duplicate(droppedItem.toObject());
        newData.system.quantity = amount;
        newData.system.container = null;
        await app.actor.createEmbeddedDocuments('Item', [newData]);
        await droppedItem.update({ 'system.quantity': qty - amount });
      }
    } else {
      if (mergeTarget) {
        await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + qty });
        await droppedItem.delete();
      } else {
        await droppedItem.update({ 'system.container': null });
      }
    }
    return;
  }

  const data = droppedItem?.toObject ? droppedItem.toObject() : droppedItem;
  if (!data) return;
  data.system = data.system ?? {};
  data.system.quantity = amount;
  const mergeTarget = findMergeTarget(app.actor, data, null);
  if (mergeTarget) {
    await mergeTarget.update({ 'system.quantity': Number(mergeTarget.system.quantity ?? 0) + amount });
  } else {
    foundry.utils.setProperty(data, 'system.container', null);
    await app.actor.createEmbeddedDocuments('Item', [data]);
  }
}

// Поиск подходящего стека для слияния в указанной локации (containerId или null)
function findMergeTarget(actor, sourceItemLike, containerId) {
  const key = getMergeKey(sourceItemLike);
  return actor.items.find(i => (i.system?.container ?? null) === (containerId ?? null)
    && i.id !== sourceItemLike.id
    && getMergeKey(i) === key);
}

function getMergeKey(itemLike) {
  const sys = itemLike.system ?? {};
  const subtype = sys.baseItem ?? sys.type?.value ?? '';
  const rarity = sys.rarity ?? '';
  const ammoType = sys.ammoType ?? '';
  return [itemLike.type, itemLike.name, itemLike.img, subtype, rarity, ammoType].join('|');
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
  console.log(`${MODULE_ID} | Модуль Custom Item Sections готов к работе`);
  
  // Проверяем, что система dnd5e
  if (game.system.id !== 'dnd5e') {
    console.warn(`${MODULE_ID} | Модуль предназначен для системы D&D 5e, текущая система: ${game.system.id}`);
  }
}); 