// 8 pontos cardeais/colaterais -- conversão pura, sem I/O, testável isolada.
const COMPASS_LABELS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"] as const;

/**
 * 0°→N, 45°→NE, 90°→E, 135°→SE, 180°→S, 225°→SO, 270°→O, 315°→NO.
 * Qualquer grau fora de [0, 360) é normalizado primeiro (ex.: -10° e 350°
 * caem no mesmo setor NO).
 */
export function degreesToCompassLabel(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % COMPASS_LABELS.length;
  return COMPASS_LABELS[index];
}
