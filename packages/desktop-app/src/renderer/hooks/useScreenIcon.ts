import { useEffect, useState } from 'react';
import { ScreenIconDTO } from '../../shared/dtos';

/**
 * The icon of the screen the bar is showing, as main pushes it.
 *
 * Main tells only of changes, so the first value is read once; a push that
 * arrives before that answer is newer, and the answer is then dropped.
 */
export const useScreenIcon = (): ScreenIconDTO | null => {
  const [icon, setIcon] = useState<ScreenIconDTO | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getScreenIcon) return undefined;
    let live = true;
    let pushed = false;
    const unsubscribe = api.onScreenIcon?.(next => {
      pushed = true;
      setIcon(next);
    });
    api
      .getScreenIcon()
      .then(current => {
        if (live && !pushed) setIcon(current);
      })
      .catch(err => console.warn('[useScreenIcon] Could not read the screen icon:', err));
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  return icon;
};
