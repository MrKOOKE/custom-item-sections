import {
  applyCellInventory,
  applyItemTooltips,
  beginOwnedItemSheetDrag,
  finishOwnedItemSheetDrag
} from "./custom-item-sections.js";
import {
  ArmorHandler as ImportedArmorHandler,
  PaperDollArmor as ImportedPaperDollArmor
} from "../../blok-upravleniya/scripts/blok-upravleniya-armor.js";

const SHEET_LABEL = "CIS: Тактический лист";
const TEMPLATE_PATH = "modules/custom-item-sections/templates/actors/tarkov-character-sheet.hbs";
const SHEET_CLASSES = ["cis-tarkov-sheet"];

const TABS = Object.freeze([
  { id: "equipment", label: "Снаряжение", placeholder: "" },
  { id: "skills", label: "Навыки/Способности", placeholder: "Пусто" },
  { id: "research", label: "Исследования", placeholder: "Пусто" },
  { id: "organism", label: "Организм", placeholder: "Пусто" },
  { id: "effects", label: "Текущие эффекты", placeholder: "Пусто" },
  { id: "biography", label: "Биография", placeholder: "Пусто" }
]);

const KNOWN_COVERAGE_AREAS = Object.freeze([
  "Шлем",
  "Очки",
  "Маска",
  "Одежда",
  "Броня",
  "Жилет",
  "Разгрузка",
  "Пояс",
  "Рюкзак",
  "Наплечники",
  "Нарукавники",
  "Перчатки",
  "Наколенники",
  "Ботинки",
  "Украшения",
  "Правая рука",
  "Левая рука"
]);

const SLOT_ORDER = Object.freeze([
  "Шлем",
  "Очки",
  "Маска",
  "Одежда",
  "Броня",
  "Разгрузка",
  "Рюкзак",
  "Наплечники",
  "Нарукавники",
  "Перчатки",
  "Жилет",
  "Пояс",
  "Наколенники",
  "Ботинки"
]);

function getArmorHandler() {
  return ImportedArmorHandler
    ?? globalThis.game?.blok?.ArmorHandler
    ?? globalThis.window?.blokUpravleniyaArmor
    ?? globalThis.game?.modules?.get?.("blok-upravleniya")?.api?.ArmorHandler
    ?? null;
}

function getPaperDollClass() {
  return ImportedPaperDollArmor
    ?? globalThis.game?.blok?.PaperDollArmor
    ?? globalThis.window?.blokUpravleniyaPaperDollArmor
    ?? globalThis.game?.modules?.get?.("blok-upravleniya")?.api?.PaperDollArmor
    ?? null;
}

function getPaperDollProto() {
  return getPaperDollClass()?.prototype ?? null;
}

function getDefaultCapacities() {
  return Object.fromEntries(KNOWN_COVERAGE_AREAS.map((area) => [area, 1]));
}

function buildTabs() {
  const preferredOrder = ["equipment", "organism", "skills", "research", "effects", "biography"];
  const orderedTabs = preferredOrder
    .map((id) => TABS.find((tab) => tab.id === id))
    .filter(Boolean);
  const remainingTabs = TABS.filter((tab) => !preferredOrder.includes(tab.id));

  return [...orderedTabs, ...remainingTabs].map((tab, index) => ({
    ...tab,
    isEquipment: tab.id === "equipment",
    active: index === 0
  }));
}

function formatMetricValue(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return digits > 0 ? numeric.toFixed(digits) : `${Math.round(numeric)}`;
}

function buildEncumbranceValue(actor) {
  const encumbrance = actor.system?.attributes?.encumbrance ?? {};
  return `${formatMetricValue(encumbrance.value, 1)} / ${formatMetricValue(encumbrance.max, 1)} Фунты`;
}

function getItemColor(item) {
  try {
    return game.modules.get("rarity-colors")?.api?.getColorFromItem(item) || "";
  } catch (_) {
    return "";
  }
}

function getCoverageCapacities(actor) {
  const handler = getArmorHandler();
  if (handler?._getCoverageCapacities) {
    try {
      return handler._getCoverageCapacities(actor);
    } catch (_) {
      return getDefaultCapacities();
    }
  }
  return getDefaultCapacities();
}

function getEquippedItemsData(actor) {
  const proto = getPaperDollProto();
  if (proto?.getEquippedItemsData) {
    try {
      return proto.getEquippedItemsData.call({ actor });
    } catch (_) {
      return Object.fromEntries(KNOWN_COVERAGE_AREAS.map((area) => [area, [null]]));
    }
  }
  return Object.fromEntries(KNOWN_COVERAGE_AREAS.map((area) => [area, [null]]));
}

function getRenderedSlotOrder() {
  const jewelryArea = KNOWN_COVERAGE_AREAS[14];
  if (SLOT_ORDER.includes(jewelryArea)) return [...SLOT_ORDER];
  return [...SLOT_ORDER, jewelryArea];
}

function buildGearSlots(actor) {
  const capacities = getCoverageCapacities(actor);
  const slotsData = getEquippedItemsData(actor);

  return getRenderedSlotOrder().reduce((result, areaName, index) => {
    const capacity = Math.max(0, Number(capacities[areaName] ?? 1));
    if (capacity <= 0) return result;

    const slots = Array.from({ length: capacity }, (_, slotIndex) => {
      const slotState = slotsData[areaName]?.[slotIndex] ?? null;
      const item = slotState?.item ?? null;
      const quantity = Number(item?.system?.quantity ?? 1);
      return {
        slotIndex,
        coverageArea: areaName,
        itemId: item?.id ?? "",
        itemName: item?.name ?? areaName,
        itemImage: item?.img ?? "",
        itemColor: item ? getItemColor(item) : "",
        itemQuantity: quantity > 1 ? quantity : null,
        empty: !item
      };
    });

    result.push({
      id: `gear-slot-${index}`,
      label: areaName,
      coverageArea: areaName,
      slots,
      isLarge: areaName === "Броня" || areaName === "Разгрузка" || areaName === "Рюкзак",
      multiSlot: capacity > 1
    });
    return result;
  }, []);
}

async function syncWeaponSets(actor) {
  const handler = getArmorHandler();
  if (!handler?._syncEchWeaponSetsForActor) return;
  try {
    await handler._syncEchWeaponSetsForActor(actor);
  } catch (_) {
    // Ignore sync failures and render current flags.
  }
}

function buildWeaponSets(actor) {
  const defaults = {
    1: { primary: null },
    2: { primary: null },
    3: { primary: null },
    4: { primary: null }
  };

  const raw = foundry.utils.deepClone(actor.getFlag("enhancedcombathud", "weaponSets") || {});
  const sets = foundry.utils.mergeObject(defaults, raw, { inplace: false, overwrite: true });
  const activeSet = String(actor.getFlag("enhancedcombathud", "activeWeaponSet") || "1");
  const activePair = (activeSet === "1" || activeSet === "2") ? "12" : "34";

  const getItemByUuid = (uuid) => actor.items.find((item) => item.uuid === uuid) ?? null;
  const makeSlot = (setKey, handLabel) => {
    const entry = sets?.[setKey] || {};
    const item = getItemByUuid(entry.primary || null);
    const quantity = Number(item?.system?.quantity ?? 1);

    return {
      setKey: String(setKey),
      handLabel,
      itemId: item?.id ?? "",
      itemName: item?.name ?? handLabel,
      itemImage: item?.img ?? "",
      itemColor: item ? getItemColor(item) : "",
      itemQuantity: quantity > 1 ? quantity : null,
      phantom: !!entry._phantom,
      empty: !item
    };
  };

  return [
    {
      pair: "12",
      label: "Набор 1",
      activateSet: "1",
      active: activePair === "12",
      slots: [
        makeSlot("2", "Левая рука"),
        makeSlot("1", "Правая рука")
      ]
    },
    {
      pair: "34",
      label: "Набор 2",
      activateSet: "3",
      active: activePair === "34",
      slots: [
        makeSlot("4", "Левая рука"),
        makeSlot("3", "Правая рука")
      ]
    }
  ];
}

function getDropData(event) {
  try {
    if (typeof TextEditor?.getDragEventData === "function") return TextEditor.getDragEventData(event);
  } catch (_) {
    // Ignore and use fallback below.
  }

  try {
    const raw = event?.dataTransfer?.getData("text/plain");
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

async function resolveDroppedActorItem(sheet, dropData) {
  if (!dropData || dropData.type !== "Item") return null;

  if (dropData.actorId === sheet.actor.id && dropData.id) {
    return sheet.actor.items.get(dropData.id) ?? null;
  }

  if (!dropData.uuid) return null;

  try {
    const item = await fromUuid(dropData.uuid);
    return item?.parent === sheet.actor ? item : null;
  } catch (_) {
    return null;
  }
}

function resolveLocalActorDropItem(sheet, dropData) {
  if (!dropData || dropData.type !== "Item") return null;

  if (dropData.actorId === sheet.actor.id && dropData.id) {
    return sheet.actor.items.get(dropData.id) ?? null;
  }

  if (!dropData.uuid) return null;
  return sheet.actor.items.find((item) => item.uuid === dropData.uuid) ?? null;
}

function getDraggedWeaponSetItem(sheet, setKey) {
  const sets = sheet.actor.getFlag("enhancedcombathud", "weaponSets") || {};
  const uuid = sets?.[String(setKey)]?.primary || null;
  if (!uuid) return null;
  return sheet.actor.items.find((item) => item.uuid === uuid) ?? null;
}

function getWeaponSlotHandAreaResolved(setKey) {
  const key = String(setKey ?? "");
  return key === "2" || key === "4" ? "Левая рука" : "Правая рука";
}

function getWeaponSlotHandArea(setKey) {
  const key = String(setKey ?? "");
  return (key === "2" || key === "4") ? "Р›РµРІР°СЏ СЂСѓРєР°" : "РџСЂР°РІР°СЏ СЂСѓРєР°";
}

function getDraggedGearSlotItem(sheet, slotElement) {
  const area = slotElement?.dataset?.slotArea || slotElement?.dataset?.id;
  const index = Number(slotElement?.dataset?.slotIndex ?? slotElement?.dataset?.index ?? 0);
  if (!area || Number.isNaN(index)) return null;
  const slotData = getEquippedItemsData(sheet.actor)?.[area]?.[index] ?? null;
  return slotData?.item ?? null;
}

function resolveDraggedSheetItem(sheet, event) {
  const source = event?.target instanceof HTMLElement ? event.target : event?.currentTarget;
  if (!(source instanceof HTMLElement)) return null;

  const dragElement = source.closest(".cis-cell-inventory-item, .cis-weapon-slot, .cis-gear-slot");
  if (!(dragElement instanceof HTMLElement)) return null;

  if (dragElement.classList.contains("cis-cell-inventory-item")) {
    return sheet.actor.items.get(dragElement.dataset.itemId) ?? null;
  }

  if (dragElement.classList.contains("cis-weapon-slot")) {
    return getDraggedWeaponSetItem(sheet, dragElement.dataset.echSet);
  }

  if (dragElement.classList.contains("cis-gear-slot")) {
    return getDraggedGearSlotItem(sheet, dragElement);
  }

  return null;
}

function clearCompatibleSlotHighlights(root) {
  if (!root) return;
  root.querySelectorAll(".cis-slot-compatible").forEach((element) => {
    element.classList.remove("cis-slot-compatible");
  });
}

function clearDragOverHighlights(root) {
  if (!root) return;
  root.querySelectorAll(".cis-gear-slot.drag-over, .cis-weapon-slot.drag-over").forEach((element) => {
    element.classList.remove("drag-over");
  });
}

function applyCompatibleSlotHighlights(root, sheet, item) {
  clearCompatibleSlotHighlights(root);
  if (!root || !item) return;
  const adapter = createPaperDollAdapter(sheet);
  if (!adapter?.filterItems) return;

  root.querySelectorAll(".cis-gear-slot").forEach((slotElement) => {
    const area = slotElement.dataset.slotArea || slotElement.dataset.id;
    const slotIndex = Number(slotElement.dataset.slotIndex ?? slotElement.dataset.index ?? 0);
    if (!area || Number.isNaN(slotIndex)) return;

    try {
      const compatible = adapter.filterItems([item], area, slotIndex);
      if (compatible?.length) slotElement.classList.add("cis-slot-compatible");
    } catch (_) {
      // Ignore compatibility failures for individual slots.
    }
  });

  let canUseWeaponSlots = false;
  try {
    canUseWeaponSlots = Boolean(
      adapter.filterItems([item], "Правая рука", 0)?.length
      || adapter.filterItems([item], "Левая рука", 0)?.length
    );
  } catch (_) {
    canUseWeaponSlots = false;
  }

  if (canUseWeaponSlots) {
    root.querySelectorAll(".cis-weapon-slot").forEach((slotElement) => {
      slotElement.classList.add("cis-slot-compatible");
    });
  }
}

function createPaperDollAdapter(sheet) {
  const proto = getPaperDollProto();
  if (!proto) return null;

  const adapter = {
    actor: sheet.actor,
    render: () => sheet.render(false),
    getEquippedItemsData() {
      return proto.getEquippedItemsData.call({ actor: sheet.actor });
    },
    _syncEchWeaponSets() {
      return proto._syncEchWeaponSets.call({ actor: sheet.actor });
    },
    getItemColor
  };

  adapter.filterItems = (...args) => proto.filterItems.call(adapter, ...args);
  adapter.setCenterContainerItems = (...args) => proto.setCenterContainerItems.call(adapter, ...args);
  adapter._showCustomItemSelectionDialog = (...args) => proto._showCustomItemSelectionDialog.call(adapter, ...args);
  adapter._onClick = (...args) => proto._onClick.call(adapter, ...args);
  adapter._onContextMenu = (...args) => proto._onContextMenu.call(adapter, ...args);
  adapter._onDragStart = (...args) => proto._onDragStart.call(adapter, ...args);
  adapter._onDrop = (...args) => proto._onDrop.call(adapter, ...args);
  adapter._equipWeapon = (...args) => proto._equipWeapon.call(adapter, ...args);
  adapter.equipItemWithCoverage = (...args) => proto.equipItemWithCoverage.call(adapter, ...args);
  adapter._echDefaultSets = (...args) => proto._echDefaultSets.call(adapter, ...args);
  adapter._echGetPairKeysForSet = (...args) => proto._echGetPairKeysForSet.call(adapter, ...args);
  adapter._echOtherPair = (...args) => proto._echOtherPair.call(adapter, ...args);
  adapter._echGetActiveSet = (...args) => proto._echGetActiveSet.call(adapter, ...args);
  adapter._echEquipPairForSet = (...args) => proto._echEquipPairForSet.call(adapter, ...args);
  adapter._echSetActive = (...args) => proto._echSetActive.call(adapter, ...args);
  adapter._echAssignWeaponToSet = (...args) => proto._echAssignWeaponToSet.call(adapter, ...args);
  adapter._echClearSet = (...args) => proto._echClearSet.call(adapter, ...args);
  adapter._onEchActivateClick = (...args) => proto._onEchActivateClick.call(adapter, ...args);
  adapter._onEchClick = (...args) => proto._onEchClick.call(adapter, ...args);
  adapter._onEchContextMenu = (...args) => proto._onEchContextMenu.call(adapter, ...args);
  adapter._onEchDragStart = (...args) => proto._onEchDragStart.call(adapter, ...args);
  adapter._onEchDrop = (...args) => proto._onEchDrop.call(adapter, ...args);

  return adapter;
}

function ensureSheetDragGhost(root) {
  if (!(root instanceof HTMLElement)) return null;
  let ghost = root.querySelector(".cis-sheet-drag-ghost");
  if (ghost) return ghost;

  ghost = document.createElement("div");
  ghost.className = "cis-sheet-drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.innerHTML = `
    <div class="cis-sheet-drag-ghost-card">
      <img class="cis-sheet-drag-ghost-image" alt="" />
      <span class="cis-sheet-drag-ghost-qty"></span>
    </div>
  `;
  root.appendChild(ghost);
  return ghost;
}

function updateSheetDragGhost(root, item, event) {
  const ghost = ensureSheetDragGhost(root);
  if (!ghost || !item) return;

  const image = ghost.querySelector(".cis-sheet-drag-ghost-image");
  const qty = ghost.querySelector(".cis-sheet-drag-ghost-qty");
  const quantity = Number(item.system?.quantity ?? 1);

  ghost.style.left = `${Number(event?.clientX ?? 0)}px`;
  ghost.style.top = `${Number(event?.clientY ?? 0)}px`;
  ghost.style.setProperty("--cis-drag-accent", getItemColor(item) || "");
  ghost.classList.add("active");

  if (image) {
    image.src = item.img || "";
    image.alt = item.name || "";
  }

  if (qty) {
    qty.textContent = quantity > 1 ? String(quantity) : "";
    qty.hidden = quantity <= 1;
  }
}

function clearSheetDragGhost(root) {
  if (!(root instanceof HTMLElement)) return;
  const ghost = root.querySelector(".cis-sheet-drag-ghost");
  if (!ghost) return;
  ghost.classList.remove("active");
}

function localizeLabel(label) {
  if (!label) return "";
  try {
    const localized = game.i18n?.localize?.(label);
    return localized && localized !== label ? localized : label;
  } catch (_) {
    return label;
  }
}

function buildHeaderButtons(sheet) {
  const rawButtons = typeof sheet._getHeaderButtons === "function"
    ? sheet._getHeaderButtons()
    : [];

  sheet._cisHeaderButtons = rawButtons.map((button, index) => ({
    ...button,
    _cisId: `header-${index}`
  }));

  return sheet._cisHeaderButtons.map((button) => ({
    id: button._cisId,
    cssClass: button.class ?? "",
    icon: button.icon ?? "",
    label: localizeLabel(button.label)
  }));
}

function getFullscreenBounds() {
  const viewportWidth = Number(globalThis.innerWidth ?? 0);
  const viewportHeight = Number(globalThis.innerHeight ?? 0);

  return {
    width: viewportWidth > 0 ? Math.max(320, viewportWidth) : 1600,
    height: viewportHeight > 0 ? Math.max(320, viewportHeight) : 920,
    left: 0,
    top: 0
  };
}

Hooks.once("init", () => {
  if (game.system?.id !== "dnd5e") return;

  const BaseSheet = globalThis.dnd5e?.applications?.actor?.ActorSheet5eCharacter ?? ActorSheet;

  class CustomItemSectionsTarkovSheet extends BaseSheet {
    static get defaultOptions() {
      const options = super.defaultOptions ?? {};
      const fullscreen = getFullscreenBounds();
      const merged = foundry.utils.mergeObject(options, {
        classes: ["sheet", "actor", "character", ...SHEET_CLASSES],
        template: TEMPLATE_PATH,
        width: fullscreen.width,
        height: fullscreen.height,
        left: fullscreen.left,
        top: fullscreen.top,
        resizable: false,
        minimizable: false,
        tabs: [
          {
            navSelector: ".cis-sheet-tabs",
            contentSelector: ".cis-sheet-body",
            initial: "equipment"
          }
        ]
      });
      merged.classes = ["sheet", "actor", "character", ...SHEET_CLASSES];
      return merged;
    }

    get template() {
      return TEMPLATE_PATH;
    }

    async _render(force = false, options = {}) {
      await super._render(force, options);
      if (!this.rendered) return;
      this.setPosition();
    }

    setPosition(options = {}) {
      const fullscreen = getFullscreenBounds();
      return super.setPosition({
        ...fullscreen,
        ...options,
        width: options.width ?? fullscreen.width,
        height: options.height ?? fullscreen.height,
        left: options.left ?? fullscreen.left,
        top: options.top ?? fullscreen.top
      });
    }

    async getData(options = {}) {
      await syncWeaponSets(this.actor);
      const context = await super.getData(options);

      return foundry.utils.mergeObject(context, {
        tabs: buildTabs(),
        headerButtons: buildHeaderButtons(this),
        gearSlots: buildGearSlots(this.actor),
        weaponSets: buildWeaponSets(this.actor)
      });
    }

    getCellInventoryToolbarMeta() {
      return {
        label: "Нагрузка",
        value: buildEncumbranceValue(this.actor)
      };
    }

    activateListeners(html) {
      super.activateListeners(html);
      applyCellInventory(this, html);
      this.#activateGearSlots(html);
      this.#activateWeaponSets(html);
      this.#activateDragHighlights(html);
      html.find(".cis-loadout-pane .item-tooltip").each((_, element) => {
        applyItemTooltips(element, this);
      });

      html.find('[data-action="header-button"]').on("click", (event) => {
        event.preventDefault();
        const buttonId = event.currentTarget.dataset.headerButtonId;
        const button = this._cisHeaderButtons?.find((candidate) => candidate._cisId === buttonId);
        if (typeof button?.onclick === "function") button.onclick(event);
      });
    }

    #activateDragHighlights(html) {
      const root = html?.[0] ?? html;
      if (!root) return;

      let activeDragItem = null;
      let activeDragSource = null;

      const beginHighlight = (event) => {
        const item = resolveDraggedSheetItem(this, event);
        if (!item) {
          activeDragItem = null;
          activeDragSource?.classList?.remove?.("dragging");
          activeDragSource = null;
          clearCompatibleSlotHighlights(root);
          clearDragOverHighlights(root);
          clearSheetDragGhost(root);
          return;
        }

        activeDragItem = item;
        activeDragSource?.classList?.remove?.("dragging");
        activeDragSource = event.target instanceof HTMLElement
          ? event.target.closest(".cis-gear-slot, .cis-weapon-slot")
          : null;
        activeDragSource?.classList?.add?.("dragging");

        updateSheetDragGhost(root, item, event);

        globalThis.requestAnimationFrame(() => {
          applyCompatibleSlotHighlights(root, this, item);
        });
      };

      const moveHighlight = (event) => {
        if (!activeDragItem) return;
        updateSheetDragGhost(root, activeDragItem, event);
      };

      const endHighlight = () => {
        activeDragItem = null;
        activeDragSource?.classList?.remove?.("dragging");
        activeDragSource = null;
        clearCompatibleSlotHighlights(root);
        clearDragOverHighlights(root);
        clearSheetDragGhost(root);
      };

      root.addEventListener("dragstart", beginHighlight, true);
      root.addEventListener("dragover", moveHighlight, true);
      root.addEventListener("dragend", endHighlight, true);
      root.addEventListener("drop", endHighlight, true);
    }

    #activateGearSlots(html) {
      const root = html?.[0] ?? html;
      if (!root) return;

      const proto = getPaperDollProto();
      const adapter = createPaperDollAdapter(this);
      if (!proto || !adapter) return;

      root.querySelectorAll(".cis-gear-slot").forEach((slotElement) => {
        slotElement.addEventListener("click", (event) => {
          adapter.render = () => this.render(false);
          adapter._onClick(event);
        });

        slotElement.addEventListener("contextmenu", async (event) => {
          adapter.render = () => this.render(false);
          await adapter._onContextMenu(event);
        });

        slotElement.addEventListener("dragstart", (event) => {
          const item = getDraggedGearSlotItem(this, slotElement);
          if (!item) {
            event.preventDefault();
            return;
          }

          beginOwnedItemSheetDrag(this.actor, item, event, {
            fromSlot: {
              slotId: slotElement.dataset.id,
              slotIndex: Number(slotElement.dataset.index ?? 0)
            }
          });
          slotElement.classList.add("dragging");
        });

        slotElement.addEventListener("dragend", () => {
          finishOwnedItemSheetDrag();
          slotElement.classList.remove("drag-over", "dragging");
        });

        slotElement.addEventListener("dragover", (event) => {
          const dropData = getDropData(event);
          const item = resolveLocalActorDropItem(this, dropData);
          if (!item) return;
          if (!adapter.filterItems([item], slotElement.dataset.id, Number(slotElement.dataset.index ?? 0))?.length) return;
          event.preventDefault();
          slotElement.classList.add("drag-over");
        });

        slotElement.addEventListener("dragleave", () => {
          slotElement.classList.remove("drag-over");
        });

        slotElement.addEventListener("drop", async (event) => {
          slotElement.classList.remove("drag-over");

          const dropData = getDropData(event);
          const item = await resolveDroppedActorItem(this, dropData);
          if (!item) return;
          if (!adapter.filterItems([item], slotElement.dataset.id, Number(slotElement.dataset.index ?? 0))?.length) return;

          event.preventDefault();
          event.stopPropagation();
          adapter.render = () => this.render(false);
          await adapter._onDrop(event);
        });
      });
    }

    #activateWeaponSets(html) {
      const root = html?.[0] ?? html;
      if (!root) return;

      const proto = getPaperDollProto();
      const adapter = createPaperDollAdapter(this);
      if (!proto || !adapter) return;

      root.querySelectorAll("[data-action='ech-activate']").forEach((element) => {
        element.addEventListener("click", async (event) => {
          adapter.render = () => this.render(false);
          await proto._onEchActivateClick.call(adapter, event);
        });
      });

      root.querySelectorAll(".cis-weapon-slot").forEach((slotElement) => {
        slotElement.addEventListener("click", async (event) => {
          adapter.render = () => this.render(false);
          await proto._onEchClick.call(adapter, event);
        });

        slotElement.addEventListener("contextmenu", async (event) => {
          adapter.render = () => this.render(false);
          await proto._onEchContextMenu.call(adapter, event);
        });

        slotElement.addEventListener("dragstart", (event) => {
          const item = getDraggedWeaponSetItem(this, slotElement.dataset.echSet);
          if (!item) {
            event.preventDefault();
            return;
          }

          beginOwnedItemSheetDrag(this.actor, item, event, {
            fromEchSet: String(slotElement.dataset.echSet)
          });
          slotElement.classList.add("dragging");
        });

        slotElement.addEventListener("dragend", () => {
          finishOwnedItemSheetDrag();
          slotElement.classList.remove("drag-over", "dragging");
        });

        slotElement.addEventListener("dragover", (event) => {
          const dropData = getDropData(event);
          const item = resolveLocalActorDropItem(this, dropData);
          if (!item) return;
          if (!adapter.filterItems([item], getWeaponSlotHandAreaResolved(slotElement.dataset.echSet), 0)?.length) return;
          event.preventDefault();
          slotElement.classList.add("drag-over");
        });

        slotElement.addEventListener("dragleave", () => {
          slotElement.classList.remove("drag-over");
        });

        slotElement.addEventListener("drop", async (event) => {
          slotElement.classList.remove("drag-over");
          const dropData = getDropData(event);
          const item = await resolveDroppedActorItem(this, dropData);
          if (!item) return;
          if (!adapter.filterItems([item], getWeaponSlotHandAreaResolved(slotElement.dataset.echSet), 0)?.length) return;
          adapter.render = () => this.render(false);
          await proto._onEchDrop.call(adapter, event);
        });
      });
    }
  }

  Actors.registerSheet("dnd5e", CustomItemSectionsTarkovSheet, {
    types: ["character"],
    label: SHEET_LABEL
  });

  Hooks.once("ready", () => {
    Object.values(ui.windows).forEach((windowApp) => {
      if (windowApp instanceof CustomItemSectionsTarkovSheet) windowApp.render(true);
    });
  });
});
