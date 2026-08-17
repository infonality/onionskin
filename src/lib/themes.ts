export type ThemeMode = "light" | "dark";

export interface ThemeInfo {
  id: string;
  label: string;
  mode: ThemeMode;
  /** Colours for the settings preview tile. */
  swatch: { chrome: string; page: string; ink: string; accent: string };
}

export const THEMES: ThemeInfo[] = [
  {
    id: "lumen-light",
    label: "Lumen",
    mode: "light",
    swatch: { chrome: "#f4f5f7", page: "#ffffff", ink: "#1f2328", accent: "#4c6ef5" },
  },
  {
    id: "paper",
    label: "Paper",
    mode: "light",
    swatch: { chrome: "#f3efe7", page: "#faf7f0", ink: "#38342c", accent: "#a0522d" },
  },
  {
    id: "github-light",
    label: "GitHub",
    mode: "light",
    swatch: { chrome: "#f6f8fa", page: "#ffffff", ink: "#1f2328", accent: "#0969da" },
  },
  {
    id: "solarized-light",
    label: "Solarized",
    mode: "light",
    swatch: { chrome: "#eee8d5", page: "#fdf6e3", ink: "#073642", accent: "#268bd2" },
  },
  {
    id: "snow",
    label: "Snow",
    mode: "light",
    swatch: { chrome: "#e5e9f0", page: "#eceff4", ink: "#2e3440", accent: "#5e81ac" },
  },

  {
    id: "lumen-dark",
    label: "Lumen",
    mode: "dark",
    swatch: { chrome: "#131519", page: "#1a1d23", ink: "#d8dde5", accent: "#7d9bff" },
  },
  {
    id: "midnight",
    label: "Midnight",
    mode: "dark",
    swatch: { chrome: "#0b1020", page: "#10162a", ink: "#ccd4e8", accent: "#8ea5ff" },
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    swatch: { chrome: "#2e3440", page: "#333a47", ink: "#d8dee9", accent: "#88c0d0" },
  },
  {
    id: "dracula",
    label: "Dracula",
    mode: "dark",
    swatch: { chrome: "#21222c", page: "#282a36", ink: "#f8f8f2", accent: "#bd93f9" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    mode: "dark",
    swatch: { chrome: "#282828", page: "#32302f", ink: "#ebdbb2", accent: "#fabd2f" },
  },
  {
    id: "solarized-dark",
    label: "Solarized",
    mode: "dark",
    swatch: { chrome: "#002b36", page: "#073642", ink: "#93a1a1", accent: "#268bd2" },
  },
];

export const DEFAULT_LIGHT_THEME = "lumen-light";
export const DEFAULT_DARK_THEME = "lumen-dark";

export const LIGHT_THEMES = THEMES.filter((t) => t.mode === "light");
export const DARK_THEMES = THEMES.filter((t) => t.mode === "dark");

export function themeById(id: string): ThemeInfo | undefined {
  return THEMES.find((t) => t.id === id);
}

export interface ThemeSelection {
  lightPalette?: string;
  darkPalette?: string;
  theme?: ThemeMode | "system";
}

/**
 * Choosing a theme assigns it to the palette slot for its own mode. If that is
 * not the mode currently on screen, also switch mode — otherwise the click
 * would appear to do nothing.
 */
export function pickTheme(
  theme: ThemeInfo,
  current: ThemeMode | "system",
): ThemeSelection {
  const slot: ThemeSelection =
    theme.mode === "light" ? { lightPalette: theme.id } : { darkPalette: theme.id };

  const showing =
    current === "system"
      ? document.documentElement.dataset.theme === "dark"
        ? "dark"
        : "light"
      : current;

  return showing === theme.mode ? slot : { ...slot, theme: theme.mode };
}

/** Falls back to the built-in theme when a stored id is no longer known. */
export function resolveTheme(id: string | undefined, mode: ThemeMode): string {
  const found = id ? themeById(id) : undefined;
  if (found && found.mode === mode) return found.id;
  return mode === "dark" ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
}
