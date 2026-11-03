import { storageGet, storageSet } from "../env.ts";
import { classify, type ClipInfo } from "./classify.ts";
import { loadRules } from "./rules.ts";
import { labelIndexFromKey, ppro } from "./timeline.ts";

/**
 * Автопокраска новых файлов: как только в проект импортировали файл (музыку, SFX, видео, графику),
 * он сразу получает цвет своей категории. Клипы, которые потом кладут на таймлайн, берут цвет файла —
 * так новые клипы ложатся уже покрашенными.
 *
 * Premiere UXP API 25.6+: EventManager.addGlobalEventListener(OperationCompleteEvent.EVENT_IMPORT_MEDIA_COMPLETE)
 * и addEventListener(project, ProjectEvent.EVENT_DIRTY) — как запасной сигнал. Файлы, которые были в проекте
 * до включения, не трогаем (для них — «Покраска проекта»).
 */

const KEY = "autoLabelNew";
const AUDIO_EXT = /\.(wav|mp3|aif|aiff|m4a|aac|flac|ogg|wma|opus)$/i;

export function isAutoLabelOn(): boolean {
  return storageGet(KEY) === "1";
}

type Listener = (n: number, names: string[]) => void;

let running: { stop(): void } | null = null;
const listeners = new Set<Listener>();

export function onAutoLabeled(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

interface Found {
  item: any;
  id: string;
  name: string;
  path: string;
  bins: string;
}

/** Все файлы проекта (рекурсивно по папкам). */
/** Сколько всего элементов в проекте — дёшево (только getItems по папкам), без запросов к каждому файлу. */
async function countItems(p: any, folder: any): Promise<number> {
  const items: any[] = (await folder.getItems()) ?? [];
  let n = items.length;
  for (const it of items) {
    const sub = p.FolderItem.cast(it);
    if (sub) n += await countItems(p, sub);
  }
  return n;
}

async function walk(p: any, folder: any, bins: string, out: Found[]): Promise<void> {
  const items: any[] = (await folder.getItems()) ?? [];
  for (const it of items) {
    const sub = p.FolderItem.cast(it);
    if (sub) {
      await walk(p, sub, `${bins} ${(await it.getName?.().catch(() => "")) ?? it.name ?? ""}`, out);
      continue;
    }
    const clip = p.ClipProjectItem.cast(it);
    if (!clip) continue;
    if (await clip.isSequence().catch(() => false)) continue;
    const id: string = await it.getId?.().catch(() => "") ?? "";
    if (!id) continue;
    out.push({ item: it, id, name: (await it.getName?.().catch(() => "")) || it.name || "", path: await clip.getMediaFilePath().catch(() => ""), bins });
  }
}

async function infoOf(p: any, f: Found): Promise<ClipInfo> {
  const audio = AUDIO_EXT.test(f.path);
  let durationSeconds = 0;
  if (audio) {
    try {
      const clip = p.ClipProjectItem.cast(f.item);
      const t = p.Constants?.MediaType?.AUDIO;
      const a = await clip.getInPoint(t);
      const b = await clip.getOutPoint(t);
      durationSeconds = Math.max(0, (b?.seconds ?? 0) - (a?.seconds ?? 0));
    } catch {
      /* без длительности — решим по имени */
    }
  }
  return {
    kind: audio ? "audio" : "video",
    // Названия папок проекта работают как «имя дорожки»: папка SFX → звуковые эффекты.
    trackName: f.bins.trim(),
    clipName: f.name,
    mediaPath: f.path,
    durationSeconds,
    isAdjustment: false,
  };
}

/** Включить/выключить автопокраску. */
export function setAutoLabel(on: boolean): void {
  storageSet(KEY, on ? "1" : "0");
  if (on) void startAutoLabel();
  else stopAutoLabel();
}

export function stopAutoLabel(): void {
  running?.stop();
  running = null;
}

/** Запустить слежение (вызывается при старте панели, если включено). */
export async function startAutoLabel(): Promise<void> {
  if (running) return;
  let p: any;
  try {
    p = ppro();
  } catch {
    return; // вне Premiere
  }
  const seen = new Set<string>();
  let projectRef: any = null;
  let projectKey = "";
  const keyOf = (pr: any) => String(pr?.path || pr?.name || "");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  let stopped = false;

  const snapshot = async () => {
    const project = await p.Project.getActiveProject();
    projectRef = project;
    projectKey = keyOf(project);
    if (!project) return;
    const all: Found[] = [];
    await walk(p, await project.getRootItem(), "", all);
    for (const f of all) seen.add(f.id);
  };

  let lastCount = -1;
  const check = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const project = await p.Project.getActiveProject();
      if (!project) return;
      if (keyOf(project) !== projectKey) {
        // Открыли другой проект — запоминаем его файлы как «старые».
        seen.clear();
        lastCount = -1;
        await snapshot();
        return;
      }
      // Полный перебор (по 4 запроса на файл) — только если число элементов изменилось: так панель не тормозит Premiere.
      const root = await project.getRootItem();
      const count = await countItems(p, root);
      if (count === lastCount) return;
      lastCount = count;
      const all: Found[] = [];
      await walk(p, root, "", all);
      const fresh = all.filter((f) => !seen.has(f.id));
      fresh.forEach((f) => seen.add(f.id));
      if (fresh.length === 0) return;

      const rules = loadRules();
      const enabled = new Set(rules.categories.filter((c) => c.enabled).map((c) => c.id));
      const actions: Array<{ item: any; index: number; name: string }> = [];
      for (const f of fresh) {
        const cat = classify(await infoOf(p, f), rules).category;
        if (!enabled.has(cat)) continue;
        const rule = rules.categories.find((c) => c.id === cat);
        if (!rule) continue;
        actions.push({ item: f.item, index: labelIndexFromKey(rule.label), name: f.name });
      }
      if (actions.length === 0) return;
      let ok = false;
      project.lockedAccess(() => {
        try {
          ok = project.executeTransaction((c: any) => {
            for (const a of actions) c.addAction(a.item.createSetColorLabelAction(a.index));
          }, "Ассистент: цвет новых файлов");
        } catch {
          ok = false;
        }
      });
      if (ok) listeners.forEach((fn) => fn(actions.length, actions.map((a) => a.name)));
    } catch {
      /* не мешаем работе — попробуем при следующем событии */
    } finally {
      busy = false;
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), 800);
  };

  await snapshot().catch(() => {});

  const EM = p.EventManager;
  const importEvt = p.OperationCompleteEvent?.EVENT_IMPORT_MEDIA_COMPLETE;
  const subs: Array<() => void> = [];
  try {
    if (EM && importEvt) {
      EM.addGlobalEventListener(importEvt, schedule);
      subs.push(() => EM.removeGlobalEventListener(importEvt, schedule));
    }
    // EVENT_DIRTY не слушаем: он приходит на каждую правку и заставлял перебирать проект во время монтажа.
  } catch {
    /* события недоступны — останется опрос */
  }
  // Запасной опрос: редко (20 с) и дёшево — сначала только счёт элементов; полный перебор лишь при изменениях.
  const poll = setInterval(() => void check(), subs.length ? 20000 : 8000);

  running = {
    stop: () => {
      stopped = true;
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      subs.forEach((s) => {
        try {
          s();
        } catch {
          /* уже снято */
        }
      });
    },
  };
}
