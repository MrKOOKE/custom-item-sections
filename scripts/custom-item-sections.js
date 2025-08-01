// Константы модуля
const MODULE_ID = 'custom-item-sections';
const FLAGS = {
  SECTION: 'section'
};

// Инициализация модуля
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Инициализация модуля Custom Item Sections`);
  
  // Регистрируем настройки, если необходимо
  registerSettings();
});

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

// Функция обработки кастомных секций
function processCustomSections(app, html, data) {
  // Проверяем, включен ли модуль
  if (!game.settings.get(MODULE_ID, 'enableCustomSections')) return;
  
  console.log(`${MODULE_ID} | Processing custom sections for actor ${app.actor.name}`);
  console.log(`${MODULE_ID} | Sheet class: ${app.constructor.name}`);
  
  // Добавляем кастомные секции в DOM для каждой вкладки
  addCustomSectionsToDOM(app, html, data);
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
    const customSectionName = item.getFlag(MODULE_ID, FLAGS.SECTION);
    const itemTab = getItemTab(item);
    
    if (customSectionName && customSectionName.trim()) {
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
  
  if (tabName === 'inventory') {
    // Заголовок для инвентаря
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
      itemsHtml += createInventoryItemHtml(item, itemContext, hasUses, quantity, price, totalWeight, data);
    } else if (tabName === 'features') {
      itemsHtml += createFeatureItemHtml(item, itemContext, hasUses, data);
    } else if (tabName === 'spells') {
      itemsHtml += createSpellItemHtml(item, itemContext, data);
    }
  });
  
  // Возвращаем полный HTML секции
  return $(`
    <div class="items-section card" data-custom-section="${sectionName}" data-type="custom" data-tab="${tabName}">
      ${headerHtml}
      <ol class="item-list unlist">
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
        data-ungrouped="all" data-grouped="${item.type}">
      
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
            <input type="text" value="${uses.value}" placeholder="0"
                   data-dtype="Number" data-name="system.uses.value" inputmode="numeric"
                   pattern="[0-9+=\-]*">
            <span class="separator">/</span>
            <span class="max">${uses.max}</span>
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
  // Обработчик для изменения количества
  html.find('[data-custom-section] input[data-name="system.quantity"]').change(async (event) => {
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
  
  // Обработчик для кнопок увеличения/уменьшения количества
  html.find('[data-custom-section] .adjustment-button').click(async (event) => {
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
  
  // Обработчик для использования предмета
  html.find('[data-custom-section] [data-action="use"]').click(async (event) => {
    const itemId = $(event.currentTarget).closest('.item').data('item-id');
    const item = app.actor.items.get(itemId);
    if (item) {
      console.log(`${MODULE_ID} | Using item ${item.name}`);
      await item.use();
    }
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

  // Добавляем обработчики перетаскивания для элементов в кастомных секциях
  html.find('[data-custom-section] .item[data-item-id]').each((index, element) => {
    const $element = $(element);
    const itemId = $element.data('item-id');
    const item = app.actor.items.get(itemId);
    
    if (item) {
      // Делаем элемент перетаскиваемым
      element.draggable = true;
      
      // Добавляем обработчик dragstart
      element.addEventListener('dragstart', (event) => {
        console.log(`${MODULE_ID} | Starting drag for item ${item.name}`);
        
        // Создаем данные для перетаскивания
        const dragData = {
          type: 'Item',
          id: item.id,
          uuid: item.uuid,
          actorId: app.actor.id,
          actorUuid: app.actor.uuid
        };
        
        // Устанавливаем данные перетаскивания
        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';
        
        // Добавляем класс для визуальной обратной связи
        $element.addClass('dragging');
      });
      
      // Добавляем обработчик dragend
      element.addEventListener('dragend', (event) => {
        console.log(`${MODULE_ID} | Ending drag for item ${item.name}`);
        $element.removeClass('dragging');
      });
      
      // Добавляем обработчик dragover для визуальной обратной связи
      element.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      });
      
      // Добавляем обработчик drop для приема других предметов
      element.addEventListener('drop', async (event) => {
        event.preventDefault();
        
        try {
          const dropData = JSON.parse(event.dataTransfer.getData('text/plain'));
          
          if (dropData.type === 'Item' && dropData.id !== item.id) {
            const droppedItem = app.actor.items.get(dropData.id);
            if (droppedItem) {
              console.log(`${MODULE_ID} | Dropped item ${droppedItem.name} onto ${item.name}`);
              
              // Здесь можно добавить логику для обработки перетаскивания предметов
              // Например, перемещение в контейнер, объединение стаков и т.д.
              
              // Пока просто показываем уведомление
              ui.notifications.info(`Перетащили ${droppedItem.name} на ${item.name}`);
            }
          }
        } catch (error) {
          console.error(`${MODULE_ID} | Error processing drop:`, error);
        }
      });
    }
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