/**
 * Макрос для синхронизации категорий предметов у актеров
 * 
 * Находит все предметы у актеров без категорий и синхронизирует их
 * с глобальными версиями предметов, у которых категории уже есть
 */

const MODULE_ID = 'custom-item-sections';
const FLAGS = {
  SECTION: 'section'
};

// Функция для получения глобального предмета по имени
function findGlobalItem(itemName) {
  // Ищем в мире
  const worldItem = game.items.getName(itemName);
  if (worldItem) {
    return worldItem;
  }
  
  // Ищем в компендиумах
  for (const pack of game.packs) {
    if (pack.documentName === 'Item') {
      try {
        const item = pack.index.getName(itemName);
        if (item) {
          return pack.getDocument(item._id);
        }
      } catch (error) {
        // Игнорируем ошибки
      }
    }
  }
  
  return null;
}

// Функция для синхронизации категории предмета
async function syncItemCategory(actorItem, globalItem) {
  try {
    const globalCategory = globalItem.getFlag(MODULE_ID, FLAGS.SECTION);
    
    if (globalCategory) {
      await actorItem.setFlag(MODULE_ID, FLAGS.SECTION, globalCategory);
      console.log(`Синхронизирована категория "${globalCategory}" для предмета "${actorItem.name}" у актера "${actorItem.parent.name}"`);
      return true;
    }
  } catch (error) {
    console.error(`Ошибка при синхронизации категории для предмета "${actorItem.name}":`, error);
  }
  
  return false;
}

// Функция для синхронизации всех актеров
async function syncAllActors() {
  const actors = game.actors.contents;
  let totalItems = 0;
  let syncedItems = 0;
  let skippedItems = 0;
  let errorItems = 0;
  
  console.log(`Начинаем синхронизацию категорий для ${actors.length} актеров...`);
  
  for (const actor of actors) {
    console.log(`Обрабатываем актера: ${actor.name} (${actor.type})`);
    
    const items = actor.items.contents;
    totalItems += items.length;
    
    for (const item of items) {
      // Проверяем, есть ли уже категория у предмета актера
      const existingCategory = item.getFlag(MODULE_ID, FLAGS.SECTION);
      
      if (existingCategory) {
        console.log(`  Пропускаем "${item.name}" - уже имеет категорию "${existingCategory}"`);
        skippedItems++;
        continue;
      }
      
      // Ищем глобальную версию предмета
      const globalItem = await findGlobalItem(item.name);
      
      if (!globalItem) {
        console.log(`  Пропускаем "${item.name}" - глобальная версия не найдена`);
        skippedItems++;
        continue;
      }
      
      // Проверяем, есть ли категория у глобальной версии
      const globalCategory = globalItem.getFlag(MODULE_ID, FLAGS.SECTION);
      
      if (!globalCategory) {
        console.log(`  Пропускаем "${item.name}" - глобальная версия не имеет категории`);
        skippedItems++;
        continue;
      }
      
      // Синхронизируем категорию
      const success = await syncItemCategory(item, globalItem);
      
      if (success) {
        syncedItems++;
      } else {
        errorItems++;
      }
    }
  }
  
  // Показываем результат
  const message = `Синхронизация завершена!\n\n` +
    `📊 Статистика:\n` +
    `• Всего предметов: ${totalItems}\n` +
    `• Синхронизировано: ${syncedItems}\n` +
    `• Пропущено: ${skippedItems}\n` +
    `• Ошибок: ${errorItems}`;
  
  console.log(message);
  
  if (syncedItems > 0) {
    ui.notifications.info(`Синхронизировано ${syncedItems} предметов с категориями`);
  } else {
    ui.notifications.warn('Нет предметов для синхронизации');
  }
  
  return { totalItems, syncedItems, skippedItems, errorItems };
}

// Функция для предварительного просмотра
async function previewSync() {
  const actors = game.actors.contents;
  let previewData = [];
  
  console.log(`Предварительный просмотр синхронизации для ${actors.length} актеров...`);
  
  for (const actor of actors) {
    const actorItems = [];
    
    for (const item of actor.items.contents) {
      // Проверяем, есть ли уже категория
      const existingCategory = item.getFlag(MODULE_ID, FLAGS.SECTION);
      
      if (existingCategory) {
        continue; // Пропускаем предметы с уже установленными категориями
      }
      
      // Ищем глобальную версию
      const globalItem = await findGlobalItem(item.name);
      
      if (globalItem) {
        const globalCategory = globalItem.getFlag(MODULE_ID, FLAGS.SECTION);
        
        if (globalCategory) {
          actorItems.push({
            name: item.name,
            type: item.type,
            globalCategory: globalCategory
          });
        }
      }
    }
    
    if (actorItems.length > 0) {
      previewData.push({
        actor: actor.name,
        actorType: actor.type,
        items: actorItems
      });
    }
  }
  
  return previewData;
}

// Создаем диалоговое окно
async function showSyncDialog() {
  const content = `
    <form>
      <p>Этот макрос найдет все предметы у актеров без категорий и синхронизирует их с глобальными версиями предметов.</p>
      
      <div class="form-group">
        <label>
          <input type="checkbox" id="previewOnly" name="previewOnly" checked>
          Только предварительный просмотр
        </label>
        <p class="notes">Если отмечено, будет показан список предметов для синхронизации без применения изменений</p>
      </div>
    </form>
  `;

  const dialog = new Dialog({
    title: 'Синхронизация категорий предметов',
    content: content,
    buttons: {
      preview: {
        label: 'Предварительный просмотр',
        callback: async (html) => {
          const previewOnly = html.find('#previewOnly').is(':checked');
          
          if (previewOnly) {
            const previewData = await previewSync();
            
            if (previewData.length === 0) {
              ui.notifications.warn('Нет предметов для синхронизации');
              return;
            }
            
            let previewContent = '<h3>Предметы для синхронизации:</h3>';
            
            for (const actorData of previewData) {
              previewContent += `<h4>${actorData.actor} (${actorData.actorType})</h4>`;
              previewContent += '<ul>';
              
              for (const item of actorData.items) {
                previewContent += `<li><strong>${item.name}</strong> (${item.type}) → категория "${item.globalCategory}"</li>`;
              }
              
              previewContent += '</ul>';
            }
            
            const previewDialog = new Dialog({
              title: 'Предварительный просмотр синхронизации',
              content: `<div style="max-height: 400px; overflow-y: auto;">${previewContent}</div>`,
              buttons: {
                sync: {
                  label: 'Выполнить синхронизацию',
                  callback: async () => {
                    await syncAllActors();
                  }
                },
                cancel: {
                  label: 'Отмена'
                }
              }
            });
            
            previewDialog.render(true);
          } else {
            await syncAllActors();
          }
        }
      },
      sync: {
        label: 'Синхронизировать',
        callback: async (html) => {
          const previewOnly = html.find('#previewOnly').is(':checked');
          
          if (!previewOnly) {
            await syncAllActors();
          }
        }
      },
      cancel: {
        label: 'Отмена'
      }
    },
    default: 'preview',
    close: () => {}
  });

  dialog.render(true);
}

// Запускаем диалог
showSyncDialog(); 