/**
 * Макрос для массового назначения категорий предметам из папки
 * 
 * Использование:
 * 1. Скопируйте ID папки (например: TBHtZPFrerkPpjWZ или Folder.TBHtZPFrerkPpjWZ)
 * 2. Запустите макрос
 * 3. Вставьте ID папки в первое поле
 * 4. Введите название категории во второе поле
 * 5. Нажмите "Применить"
 * 
 * Все предметы в указанной папке и всех её подпапках получат указанную категорию
 */

const MODULE_ID = 'custom-item-sections';
const FLAGS = {
  SECTION: 'section'
};

// Функция для поиска папки в разных контекстах
async function findFolder(folderId) {
  console.log(`Ищем папку с ID: ${folderId}`);
  
  // Убираем префикс "Folder." если он есть
  const cleanFolderId = folderId.replace(/^Folder\./, '');
  console.log(`Очищенный ID папки: ${cleanFolderId}`);
  
  // 1. Сначала ищем в текущем мире
  let folder = game.folders.get(cleanFolderId);
  if (folder) {
    console.log(`Найдена папка в мире: ${folder.name} (${folder.id})`);
    return folder;
  }
  
  // 2. Если не найдена, попробуем найти по полному ID
  folder = game.folders.get(folderId);
  if (folder) {
    console.log(`Найдена папка в мире (полный ID): ${folder.name} (${folder.id})`);
    return folder;
  }
  
  // 3. Ищем в компендиумах
  for (const pack of game.packs) {
    if (pack.documentName === 'Folder') {
      try {
        const folderDoc = await pack.getDocument(cleanFolderId);
        if (folderDoc) {
          console.log(`Найдена папка в компендиуме ${pack.metadata.label}: ${folderDoc.name}`);
          return folderDoc;
        }
      } catch (error) {
        // Игнорируем ошибки при поиске в компендиумах
      }
    }
  }
  
  // 4. Ищем среди всех доступных папок
  const allFolders = game.folders.contents;
  console.log(`Доступные папки в мире:`, allFolders.map(f => `${f.name} (${f.id})`));
  
  // 5. Показываем список всех папок предметов для отладки
  const itemFolders = allFolders.filter(f => f.type === 'Item');
  console.log(`Папки предметов в мире:`, itemFolders.map(f => `${f.name} (${f.id})`));
  
  // 6. Попробуем найти папку по имени (если ID не работает)
  const folderByName = itemFolders.find(f => f.name.toLowerCase().includes(cleanFolderId.toLowerCase()));
  if (folderByName) {
    console.log(`Найдена папка по имени: ${folderByName.name} (${folderByName.id})`);
    return folderByName;
  }
  
  throw new Error(`Папка с ID ${folderId} (очищенный: ${cleanFolderId}) не найдена ни в мире, ни в компендиумах`);
}

// Функция для рекурсивного получения всех предметов из папки и её подпапок
async function getAllItemsFromFolderRecursive(folder) {
  const allItems = [];
  const processedFolders = new Set();
  
  async function processFolder(currentFolder) {
    if (processedFolders.has(currentFolder.id)) {
      return; // Избегаем циклических ссылок
    }
    
    processedFolders.add(currentFolder.id);
    console.log(`Обрабатываем папку: ${currentFolder.name} (${currentFolder.id})`);
    
    // Получаем предметы из текущей папки
    if (currentFolder.contents && currentFolder.contents.length > 0) {
      console.log(`  Найдено ${currentFolder.contents.length} предметов в папке "${currentFolder.name}"`);
      allItems.push(...currentFolder.contents);
    }
    
    // Получаем все подпапки используя правильный метод getSubfolders
    let subfolders = [];
    if (currentFolder.getSubfolders) {
      try {
        // Получаем только прямых потомков (не рекурсивно)
        subfolders = currentFolder.getSubfolders(false);
        console.log(`  Найдено ${subfolders.length} подпапок в папке "${currentFolder.name}":`, subfolders.map(f => f.name));
      } catch (error) {
        console.error(`Ошибка при получении подпапок для папки "${currentFolder.name}":`, error);
      }
    } else {
      // Fallback: используем старый способ если getSubfolders недоступен
      subfolders = game.folders.contents.filter(f => f.parent === currentFolder.id);
      console.log(`  Fallback: найдено ${subfolders.length} подпапок в папке "${currentFolder.name}":`, subfolders.map(f => f.name));
    }
    
    // Рекурсивно обрабатываем каждую подпапку
    for (const subfolder of subfolders) {
      await processFolder(subfolder);
    }
  }
  
  await processFolder(folder);
  return allItems;
}

// Функция для получения всех предметов из папки (включая подпапки)
async function getItemsFromFolder(folderId) {
  try {
    // Находим папку
    const folder = await findFolder(folderId);
    
    if (folder.type !== 'Item') {
      throw new Error(`Папка ${folder.name} не является папкой предметов (тип: ${folder.type})`);
    }
    
    console.log(`Найдена папка предметов: ${folder.name}`);
    
    // Получаем все предметы рекурсивно (включая подпапки)
    const items = await getAllItemsFromFolderRecursive(folder);
    
    console.log(`Найдено предметов во всей иерархии папок: ${items.length}`);
    
    if (items.length > 0) {
      console.log('Предметы в иерархии папок:', items.map(item => `${item.name} (${item.type})`));
    }
    
    return items;
  } catch (error) {
    console.error('Ошибка при получении предметов из папки:', error);
    throw error;
  }
}

// Функция для назначения категории предмету
async function assignCategoryToItem(item, categoryName) {
  try {
    await item.setFlag(MODULE_ID, FLAGS.SECTION, categoryName);
    console.log(`Категория "${categoryName}" назначена предмету "${item.name}"`);
    return true;
  } catch (error) {
    console.error(`Ошибка при назначении категории предмету "${item.name}":`, error);
    return false;
  }
}

// Функция для массового назначения категорий
async function bulkAssignCategories(folderId, categoryName) {
  try {
    // Получаем предметы из папки (включая подпапки)
    const items = await getItemsFromFolder(folderId);
    
    if (items.length === 0) {
      ui.notifications.warn('В указанной папке и её подпапках нет предметов');
      return;
    }
    
    // Назначаем категорию каждому предмету
    let successCount = 0;
    let errorCount = 0;
    
    for (const item of items) {
      const success = await assignCategoryToItem(item, categoryName);
      if (success) {
        successCount++;
      } else {
        errorCount++;
      }
    }
    
    // Показываем результат
    if (successCount > 0) {
      ui.notifications.info(`Категория "${categoryName}" успешно назначена ${successCount} предметам во всей иерархии папок`);
    }
    
    if (errorCount > 0) {
      ui.notifications.warn(`Не удалось назначить категорию ${errorCount} предметам`);
    }
    
    console.log(`Массовое назначение завершено. Успешно: ${successCount}, Ошибок: ${errorCount}`);
    
  } catch (error) {
    console.error('Ошибка при массовом назначении категорий:', error);
    ui.notifications.error(`Ошибка: ${error.message}`);
  }
}

// Создаем диалоговое окно
async function showBulkCategoryDialog() {
  const content = `
    <form>
      <div class="form-group">
        <label for="folderId">ID папки:</label>
        <input type="text" id="folderId" name="folderId" style="width: 100%;">
      </div>
      
      <div class="form-group">
        <label for="categoryName">Название категории:</label>
        <input type="text" id="categoryName" name="categoryName" style="width: 100%;">
      </div>
    </form>
  `;

  const dialog = new Dialog({
    title: 'Массовое назначение категорий',
    content: content,
    buttons: {
      apply: {
        label: 'Применить',
        callback: async (html) => {
          const folderId = html.find('#folderId').val().trim();
          const categoryName = html.find('#categoryName').val().trim();
          
          if (!folderId) {
            ui.notifications.warn('Введите ID папки');
            return;
          }
          
          if (!categoryName) {
            ui.notifications.warn('Введите название категории');
            return;
          }
          
          await bulkAssignCategories(folderId, categoryName);
        }
      },
      cancel: {
        label: 'Отмена'
      }
    },
    default: 'apply',
    close: () => {}
  });

  dialog.render(true);
}

// Запускаем диалог
showBulkCategoryDialog(); 