import { applyCellInventory } from "./custom-item-sections.js";
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
  "Украшения",
  "Наплечники",
  "Нарукавники",
  "Перчатки",
  "Одежда",
  "Броня",
  "Жилет",
  "Разгрузка",
  "Пояс",
  "Рюкзак",
  "Наколенники",
  "Ботинки",
  "Левая рука",
  "Правая рука"
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
  return TABS.map((tab, index) => ({
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

function buildMetrics(actor) {
  const hp = actor.system?.attributes?.hp ?? {};
  const ac = actor.system?.attributes?.ac ?? {};
  const encumbrance = actor.system?.attributes?.encumbrance ?? {};
  const effects = actor.effects?.filter((effect) => !effect.disabled) ?? [];
  const metricWeightUnits = game.settings.get("dnd5e", "metricWeightUnits");
  const weightUnit = metricWeightUnits ? "кг" : "lb";

  return [
    {
      id: "hp",
      label: "Хиты",
      value: `${formatMetricValue(hp.value)} / ${formatMetricValue(hp.max)}`,
      accent: "health"
    },
    {
      id: "ac",
      label: "Броня",
      value: formatMetricValue(ac.value ?? 0),
      accent: "armor"
    },
    {
      id: "weight",
      label: "Нагрузка",
      value: `${formatMetricValue(encumbrance.value, 1)} / ${formatMetricValue(encumbrance.max, 1)} ${weightUnit}`,
      accent: "weight",
      badge: effects.length ? `${effects.length} эффект.` : ""
    }
  ];
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

function buildGearSlots(actor) {
  const capacities = getCoverageCapacities(actor);
  const slotsData = getEquippedItemsData(actor);

  return SLOT_ORDER.reduce((result, areaName, index) => {
    const capacity = Math.max(0, Number(capacities[areaName] ?? 1));
    if (capacity <= 0) return result;

    const slots = Array.from({ length: capacity }, (_, slotIndex) => {
      const slotState = slotsData[areaName]?.[slotIndex] ?? null;
      const item = slotState?.item ?? null;
      const quantity = Number(item?.system?.quantity ?? 1);
      return {
        slotIndex,
        coverageArea: areaName,
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
      isHand: areaName === "Левая рука" || areaName === "Правая рука",
      isLarge: areaName === "Броня" || areaName === "Разгрузка" || areaName === "Рюкзак",
      multiSlot: capacity > 1
    });
    return result;
  }, []);
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
  adapter._equipWeapon = (...args) => proto._equipWeapon.call(adapter, ...args);
  adapter.equipItemWithCoverage = (...args) => proto.equipItemWithCoverage.call(adapter, ...args);

  return adapter;
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
      const context = await super.getData(options);
      const classLabel = context.classLabels || context.labels?.class || context.labels?.type || "";
      const typeLabel = context.labels?.type || "";
      const summary = [classLabel, typeLabel].filter(Boolean).join(" / ");

      return foundry.utils.mergeObject(context, {
        tabs: buildTabs(),
        headerButtons: buildHeaderButtons(this),
        gearSlots: buildGearSlots(this.actor),
        metrics: buildMetrics(this.actor),
        summary: summary || "Персонаж"
      });
    }

    activateListeners(html) {
      super.activateListeners(html);
      applyCellInventory(this, html);
      this.#activateGearSlots(html);

      html.find('[data-action="header-button"]').on("click", (event) => {
        event.preventDefault();
        const buttonId = event.currentTarget.dataset.headerButtonId;
        const button = this._cisHeaderButtons?.find((candidate) => candidate._cisId === buttonId);
        if (typeof button?.onclick === "function") button.onclick(event);
      });
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
          proto._onClick.call(adapter, event);
        });

        slotElement.addEventListener("contextmenu", async (event) => {
          adapter.render = () => this.render(false);
          await proto._onContextMenu.call(adapter, event);
        });

        slotElement.addEventListener("dragover", (event) => {
          const dropData = getDropData(event);
          if (!dropData || dropData.type !== "Item") return;
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

          event.preventDefault();
          event.stopPropagation();
          adapter.render = () => this.render(false);
          await adapter.equipItemWithCoverage(item, {
            targetCoverageArea: slotElement.dataset.id,
            targetSlotIndex: Number(slotElement.dataset.index ?? 0)
          });
          this.render(false);
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
