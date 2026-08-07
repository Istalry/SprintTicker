/**
 * Formats duration in total seconds to HH:MM:SS or MM:SS display string.
 */
export function formatSeconds(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const pad = (num: number) => num.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats total seconds as "Xh YYm" string for summary views.
 */
export function formatHoursAndMinutes(totalSeconds: number): string {
  const hrs = Math.floor((totalSeconds || 0) / 3600);
  const mins = Math.floor(((totalSeconds || 0) % 3600) / 60);
  return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
}
