/**
 * Кто говорит → какая камера в кадре. Чистая функция (без Premiere) — проверяется тестом.
 * levels[mic][окно] — громкость в дБ; окно `win` секунд. Микрофон i снимает камера camForMic[i].
 */

export interface ShotOptions {
  win: number;
  camForMic: number[];
  /** Общий план (камера без микрофона) — при перебивании и долгой тишине; null — нет. */
  wide: number | null;
  /** Минимальная длина плана, с. */
  minShot: number;
  /** Сколько говорящий должен говорить, чтобы переключиться, с. */
  hold?: number;
}

export interface Shot {
  start: number;
  end: number;
  cam: number;
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] ?? -90;
}

export function decideShots(levels: number[][], opt: ShotOptions): Shot[] {
  const mics = levels.length;
  const n = Math.min(...levels.map((l) => l.length));
  if (!mics || !n) return [];
  const hold = Math.max(1, Math.round((opt.hold ?? 0.5) / opt.win));
  const minLen = Math.max(1, Math.round(opt.minShot / opt.win));
  const wideHold = Math.round(1 / opt.win);
  // Порог речи для каждого микрофона: шум (20-й перцентиль) + 10 дБ, но не ниже −50 дБ.
  const floor = levels.map((l) => Math.max(percentile(l, 0.2) + 10, -50));

  // 1. Сырое решение на каждое окно: камера говорящего, «оба» (-2) или тишина (-1).
  const raw: number[] = [];
  for (let w = 0; w < n; w++) {
    const active: Array<{ m: number; v: number }> = [];
    for (let m = 0; m < mics; m++) if (levels[m][w] > floor[m]) active.push({ m, v: levels[m][w] - floor[m] });
    if (!active.length) raw.push(-1);
    else {
      active.sort((a, b) => b.v - a.v);
      if (active.length > 1 && active[0].v - active[1].v < 6) raw.push(-2);
      else raw.push(opt.camForMic[active[0].m]);
    }
  }

  // 2. Сглаживание: переключаемся, только если новый вариант держится `hold` окон и текущий план не короче minShot.
  const first = raw.find((r) => r >= 0);
  let cur = first ?? opt.wide ?? opt.camForMic[0];
  let since = 0;
  const out: number[] = [];
  let cand = cur;
  let candLen = 0;
  for (let w = 0; w < n; w++) {
    let want = raw[w];
    if (want === -1) want = cur; // тишина — оставляем
    if (want === -2) want = opt.wide ?? cur; // перебивают — общий план, если есть
    const need = want === opt.wide ? wideHold : hold;
    if (want === cand) candLen++;
    else {
      cand = want;
      candLen = 1;
    }
    if (cand !== cur && candLen >= need && since >= minLen) {
      // Переключение задним числом — с начала реплики.
      for (let k = Math.max(0, out.length - candLen + 1); k < out.length; k++) out[k] = cand;
      cur = cand;
      since = candLen - 1;
    }
    out.push(cur);
    since++;
  }

  // 3. В отрезки.
  const shots: Shot[] = [];
  for (let w = 0; w < n; w++) {
    const t = w * opt.win;
    const last = shots[shots.length - 1];
    if (last && last.cam === out[w]) last.end = t + opt.win;
    else shots.push({ start: t, end: t + opt.win, cam: out[w] });
  }
  return shots;
}
