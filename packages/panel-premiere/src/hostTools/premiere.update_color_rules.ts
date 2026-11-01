import { isLabelKey, LABEL_KEYS, type LabelKey } from "../automation/labels.ts";
import { CATEGORY_ORDER, loadRules, saveRules, type CategoryId } from "../automation/rules.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  setColors?: Partial<Record<CategoryId, LabelKey>>;
  addKeywords?: Partial<Record<CategoryId, string[]>>;
  removeKeywords?: Partial<Record<CategoryId, string[]>>;
  addOverrides?: Array<{ match: string; category: CategoryId }>;
  removeOverrides?: string[];
  enable?: CategoryId[];
  disable?: CategoryId[];
  musicMinSeconds?: number;
}

const catMap = (items: Record<string, unknown>) => ({
  type: "object" as const,
  properties: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, items])) as Record<string, any>,
  additionalProperties: false,
});

/** «Доучивание»: меняет правила покраски по просьбе пользователя. */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.update_color_rules",
    description:
      "Меняет правила покраски таймлайна — так ассистент запоминает предпочтения пользователя. Примеры: «музыку крась в " +
      "синий» → setColors {music: BLUE}; «файлы из папки Whoosh — это SFX» → addOverrides [{match: \"whoosh\", category: \"sfx\"}]; " +
      "«слово stem — это музыка» → addKeywords {music: [\"stem\"]}. Цвета: " + LABEL_KEYS.join(", ") + ". " +
      "Категории: " + CATEGORY_ORDER.join(", ") + ". После изменения можно перекрасить через premiere.color_timeline.",
    inputSchema: {
      type: "object",
      properties: {
        setColors: catMap({ type: "string", enum: [...LABEL_KEYS] }),
        addKeywords: catMap({ type: "array", items: { type: "string" } }),
        removeKeywords: catMap({ type: "array", items: { type: "string" } }),
        addOverrides: {
          type: "array",
          items: {
            type: "object",
            properties: { match: { type: "string" }, category: { type: "string", enum: CATEGORY_ORDER } },
            required: ["match", "category"],
          },
        },
        removeOverrides: { type: "array", items: { type: "string" } },
        enable: { type: "array", items: { type: "string", enum: CATEGORY_ORDER } },
        disable: { type: "array", items: { type: "string", enum: CATEGORY_ORDER } },
        musicMinSeconds: { type: "number", minimum: 1 },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Изменить правила покраски таймлайна (что именно — в «Параметрах» ниже). Сам проект не меняется.",
  },
  async run(input) {
    const rules = loadRules();
    const cat = (id: CategoryId) => {
      const c = rules.categories.find((x) => x.id === id);
      if (!c) throw new HostToolError(`Нет категории «${id}».`);
      return c;
    };
    for (const [id, label] of Object.entries(input.setColors ?? {})) {
      if (!isLabelKey(label)) throw new HostToolError(`Нет цвета «${label}».`);
      cat(id as CategoryId).label = label;
    }
    for (const [id, words] of Object.entries(input.addKeywords ?? {})) {
      const c = cat(id as CategoryId);
      c.keywords = [...new Set([...c.keywords, ...(words ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean)])];
    }
    for (const [id, words] of Object.entries(input.removeKeywords ?? {})) {
      const drop = new Set((words ?? []).map((w) => w.trim().toLowerCase()));
      const c = cat(id as CategoryId);
      c.keywords = c.keywords.filter((k) => !drop.has(k));
    }
    for (const o of input.addOverrides ?? []) {
      const match = o.match.trim().toLowerCase();
      rules.overrides = [...rules.overrides.filter((x) => x.match !== match), { match, category: o.category }];
    }
    const removeO = new Set((input.removeOverrides ?? []).map((m) => m.trim().toLowerCase()));
    rules.overrides = rules.overrides.filter((o) => !removeO.has(o.match));
    for (const id of input.enable ?? []) cat(id).enabled = true;
    for (const id of input.disable ?? []) cat(id).enabled = false;
    if (input.musicMinSeconds) rules.musicMinSeconds = input.musicMinSeconds;
    return { saved: true, rules: saveRules(rules) };
  },
};

export default tool;
