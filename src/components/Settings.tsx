import { X } from "lucide-react";
import { useEffect } from "react";
import {
  DARK_THEMES,
  LIGHT_THEMES,
  pickTheme,
  type ThemeInfo,
} from "../lib/themes";
import { schedulePersist } from "../state/actions";
import { prettyKeys } from "../state/commands";
import {
  useStore,
  type ContentWidth,
  type Settings as SettingsShape,
  type ThemeChoice,
  type TypeFace,
} from "../state/store";

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`sheet${wide ? " is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? "is-active" : ""}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint ? <span className="setting-hint">{hint}</span> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

function ThemeTile({
  theme,
  active,
  onPick,
}: {
  theme: ThemeInfo;
  active: boolean;
  onPick: () => void;
}) {
  const { chrome, page, ink, accent } = theme.swatch;
  return (
    <button
      type="button"
      className={`theme-tile${active ? " is-active" : ""}`}
      onClick={onPick}
      aria-pressed={active}
      title={theme.label}
    >
      <span className="theme-tile-art" style={{ background: chrome, borderColor: ink + "22" }}>
        <span className="theme-tile-page" style={{ background: page }}>
          <span className="theme-tile-head" style={{ background: ink }} />
          <span className="theme-tile-line" style={{ background: ink, opacity: 0.4 }} />
          <span className="theme-tile-line short" style={{ background: ink, opacity: 0.4 }} />
          <span className="theme-tile-dot" style={{ background: accent }} />
        </span>
      </span>
      <span className="theme-tile-label">{theme.label}</span>
    </button>
  );
}

export function SettingsSheet() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const patch = useStore((s) => s.patchSettings);

  if (!open) return null;

  const update = (p: Partial<SettingsShape>) => {
    patch(p);
    schedulePersist();
  };

  return (
    <Modal title="Settings" onClose={() => setOpen(false)}>
      <section className="setting-group">
        <h3>Appearance</h3>
        <Row label="Mode" hint="System follows your OS light/dark setting.">
          <Segmented<ThemeChoice>
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </Row>

        <div className="theme-section">
          <span className="theme-section-title">Light theme</span>
          <div className="theme-grid">
            {LIGHT_THEMES.map((t) => (
              <ThemeTile
                key={t.id}
                theme={t}
                active={settings.lightPalette === t.id}
                onPick={() => update(pickTheme(t, settings.theme))}
              />
            ))}
          </div>
        </div>

        <div className="theme-section">
          <span className="theme-section-title">Dark theme</span>
          <div className="theme-grid">
            {DARK_THEMES.map((t) => (
              <ThemeTile
                key={t.id}
                theme={t}
                active={settings.darkPalette === t.id}
                onPick={() => update(pickTheme(t, settings.theme))}
              />
            ))}
          </div>
        </div>

        <Row label="Typeface" hint="Used for body text in the editor.">
          <Segmented<TypeFace>
            value={settings.typeface}
            onChange={(typeface) => update({ typeface })}
            options={[
              { value: "serif", label: "Serif" },
              { value: "sans", label: "Sans" },
              { value: "mono", label: "Mono" },
            ]}
          />
        </Row>
        <Row label="Text size">
          <div className="stepper">
            <button
              type="button"
              onClick={() => update({ fontSize: Math.max(12, settings.fontSize - 1) })}
            >
              −
            </button>
            <span>{settings.fontSize}px</span>
            <button
              type="button"
              onClick={() => update({ fontSize: Math.min(28, settings.fontSize + 1) })}
            >
              +
            </button>
          </div>
        </Row>
        <Row label="Line width" hint="How wide a paragraph gets before it wraps.">
          <Segmented<ContentWidth>
            value={settings.contentWidth}
            onChange={(contentWidth) => update({ contentWidth })}
            options={[
              { value: "narrow", label: "Narrow" },
              { value: "normal", label: "Normal" },
              { value: "wide", label: "Wide" },
            ]}
          />
        </Row>
      </section>

      <section className="setting-group">
        <h3>Writing</h3>
        <Row label="Source mode" hint="Show raw Markdown instead of live preview.">
          <Toggle on={settings.sourceMode} onChange={(v) => update({ sourceMode: v })} />
        </Row>
        <Row label="Focus mode" hint="Dim every paragraph except the one you are in.">
          <Toggle on={settings.focusMode} onChange={(v) => update({ focusMode: v })} />
        </Row>
        <Row label="Typewriter mode" hint="Keep the caret near the middle of the window.">
          <Toggle on={settings.typewriter} onChange={(v) => update({ typewriter: v })} />
        </Row>
        <Row label="Check spelling">
          <Toggle on={settings.spellcheck} onChange={(v) => update({ spellcheck: v })} />
        </Row>
      </section>

      <section className="setting-group">
        <h3>Files</h3>
        <Row label="Show all files" hint="Otherwise the sidebar lists Markdown and text only.">
          <Toggle on={settings.showAllFiles} onChange={(v) => update({ showAllFiles: v })} />
        </Row>
      </section>
    </Modal>
  );
}

const SHORTCUT_GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: "File",
    rows: [
      ["New document", "Mod+N"],
      ["Open file", "Mod+O"],
      ["Open folder", "Mod+Shift+O"],
      ["Save", "Mod+S"],
      ["Save as", "Mod+Shift+S"],
      ["Print / export PDF", "Mod+P"],
      ["Close tab", "Mod+W"],
    ],
  },
  {
    title: "Navigate",
    rows: [
      ["Command palette", "Mod+Shift+P"],
      ["Quick open file", "Mod+K"],
      ["Find in document", "Mod+F"],
      ["Find and replace", "Mod+Alt+F"],
      ["Toggle sidebar", "Mod+\\"],
      ["Toggle outline", "Mod+Shift+\\"],
      ["Next / previous tab", "Ctrl+Tab"],
    ],
  },
  {
    title: "Format",
    rows: [
      ["Bold", "Mod+B"],
      ["Italic", "Mod+I"],
      ["Strikethrough", "Mod+Shift+X"],
      ["Inline code", "Mod+E"],
      ["Highlight", "Mod+Shift+H"],
      ["Insert link", "Mod+L"],
      ["Heading 1–6", "Mod+1…6"],
      ["Paragraph", "Mod+0"],
      ["Blockquote", "Mod+Shift+Q"],
      ["Bulleted list", "Mod+Shift+8"],
      ["Numbered list", "Mod+Shift+9"],
      ["Task list", "Mod+Shift+0"],
      ["Toggle task done", "Mod+Enter"],
      ["Code block", "Mod+Shift+K"],
      ["Table", "Mod+Shift+T"],
      ["Horizontal rule", "Mod+Shift+R"],
    ],
  },
  {
    title: "View",
    rows: [
      ["Source mode", "Mod+/"],
      ["Focus mode", "Mod+Shift+F"],
      ["Dark mode", "Mod+Shift+D"],
      ["Zoom in / out", "Mod+= / Mod+-"],
      ["Actual size", "Mod+Shift+="],
      ["Full screen", "F11"],
    ],
  },
];

export function ShortcutsSheet() {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  if (!open) return null;

  return (
    <Modal title="Keyboard Shortcuts" onClose={() => setOpen(false)} wide>
      <div className="shortcut-grid">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="setting-group">
            <h3>{group.title}</h3>
            {group.rows.map(([label, keys]) => (
              <div className="shortcut-row" key={label}>
                <span>{label}</span>
                <kbd>{prettyKeys(keys)}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
