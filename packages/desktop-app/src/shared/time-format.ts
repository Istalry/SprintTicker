/**
 * Logged time, written the same everywhere: `1h 05m`, `55m`, and `40s` for
 * less than a minute, which would otherwise read as nothing logged. Shared:
 * the window writes it, and so does main in the Undo bar's label.
 */
export function formatHoursAndMinutes(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  if (mins > 0) return `${mins}m`;
  return `${safe}s`;
}
