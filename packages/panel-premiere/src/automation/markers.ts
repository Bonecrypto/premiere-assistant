import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "./timeline.ts";

/**
 * Маркеры секвенции (Premiere UXP API 25.6+): Markers.getMarkers(sequence) →
 * createAddMarkerAction(name, type, start, duration, comments) / createRemoveMarkerAction(marker).
 */

export type MarkerMode = "cuts" | "interval";

async function context() {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const markers = await p.Markers.getMarkers(sequence);
  return { p, project, sequence, markers };
}

function run(project: any, title: string, fill: (c: any) => void): void {
  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction(fill, title);
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал изменить маркеры: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError("Premiere отклонил изменение маркеров.");
}

/** Времена склеек: начала клипов на видеодорожках (без нуля и повторов). */
async function cutTimes(p: any, sequence: any): Promise<number[]> {
  const times = new Set<number>();
  const count = await sequence.getVideoTrackCount();
  for (let i = 0; i < count; i++) {
    const track = await sequence.getVideoTrack(i);
    const items: any[] = (await track?.getTrackItems(p.Constants.TrackItemType.CLIP, false)) ?? [];
    for (const it of items) {
      const s = (await it.getStartTime()).seconds as number;
      if (s > 0.01) times.add(Math.round(s * 1000) / 1000);
    }
  }
  return [...times].sort((a, b) => a - b);
}

export async function addMarkers(mode: MarkerMode, interval = 10, name = "Маркер"): Promise<{ added: number }> {
  const { p, project, sequence, markers } = await context();
  let times: number[];
  if (mode === "cuts") {
    times = await cutTimes(p, sequence);
  } else {
    const end = (await sequence.getEndTime()).seconds as number;
    const step = Math.max(1, interval);
    times = [];
    for (let t = step; t < end - 0.01; t += step) times.push(Math.round(t * 1000) / 1000);
  }
  if (times.length === 0) throw new HostToolError(mode === "cuts" ? "В секвенции нет склеек." : "Секвенция короче интервала.");
  if (times.length > 500) throw new HostToolError(`Слишком много маркеров (${times.length}). Увеличьте интервал.`);

  const type = p.Marker?.MARKER_TYPE_COMMENT ?? "Comment";
  run(project, "Ассистент: маркеры", (c) => {
    times.forEach((t, i) => {
      c.addAction(
        markers.createAddMarkerAction(
          mode === "cuts" ? `Склейка ${i + 1}` : `${name} ${i + 1}`,
          type,
          p.TickTime.createWithSeconds(t),
          p.TickTime.TIME_ZERO,
          "",
        ),
      );
    });
  });
  return { added: times.length };
}

export async function clearMarkers(): Promise<{ removed: number }> {
  const { project, markers } = await context();
  const list: any[] = (await markers.getMarkers()) ?? [];
  if (list.length === 0) return { removed: 0 };
  run(project, "Ассистент: очистить маркеры", (c) => {
    for (const m of list) c.addAction(markers.createRemoveMarkerAction(m));
  });
  return { removed: list.length };
}
