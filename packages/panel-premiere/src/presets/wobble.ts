/** Плавное блуждание (camera wobble): смещение в долях амплитуды, t — секунды. */
export function wobbleAt(t: number, hz: number): { x: number; y: number; r: number } {
  const w = 2 * Math.PI * hz;
  return {
    x: 0.65 * Math.sin(w * t + 0.3) + 0.35 * Math.sin(w * 1.83 * t + 1.7),
    y: 0.65 * Math.sin(w * 0.91 * t + 2.1) + 0.35 * Math.sin(w * 1.57 * t + 0.4),
    r: 0.7 * Math.sin(w * 0.77 * t + 1.1) + 0.3 * Math.sin(w * 1.41 * t + 2.6),
  };
}
