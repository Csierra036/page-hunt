// Player settings kept in localStorage (per browser). The game works without storage.
export interface Settings {
  /** KeyboardEvent.code of the reload key. */
  reloadKey: string;
  muted: boolean;
  volume: number;
  shake: boolean;
}

const KEY = 'page-hunt:settings';

export const DEFAULTS: Settings = { reloadKey: 'KeyR', muted: false, volume: 0.6, shake: true };

/** Keys the game already uses; the reload key cannot be bound to them. */
export const RESERVED_KEYS = ['KeyP', 'Escape', 'KeyM', 'Tab'];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Private mode or blocked storage: defaults.
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore: settings just won't persist.
  }
}

/** "KeyR" -> "R", "Space" -> "Espacio". */
export function keyLabel(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = { Space: 'Espacio', ShiftLeft: 'Mayús', ShiftRight: 'Mayús der.', ControlLeft: 'Ctrl', Enter: 'Intro' };
  return names[code] ?? code;
}
