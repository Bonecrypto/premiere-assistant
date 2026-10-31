import type { ToolSpec } from "@pa/core";

/** Host-инструмент: выполняется в панели через Premiere DOM API. */
export interface HostTool<Input = any> {
  spec: Omit<ToolSpec, "runsIn"> & { runsIn: "host" };
  run(input: Input): Promise<unknown>;
}

/** Ошибка, понятная человеку (и модели). */
export class HostToolError extends Error {}
