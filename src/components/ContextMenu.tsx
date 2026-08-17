import { Check, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { prettyKeys } from "../state/commands";

export interface MenuCommand {
  label: string;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  run: () => void;
}

export interface MenuGroup {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  submenu: MenuNode[];
}

export type MenuNode = "-" | MenuCommand | MenuGroup;

const isGroup = (node: MenuNode): node is MenuGroup =>
  node !== "-" && "submenu" in node;
const isCommand = (node: MenuNode): node is MenuCommand =>
  node !== "-" && "run" in node;

interface OpenMenu {
  x: number;
  y: number;
  items: MenuNode[];
}

let active: OpenMenu | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops leading, trailing and repeated separators. */
function tidy(items: MenuNode[]): MenuNode[] {
  const out: MenuNode[] = [];
  for (const item of items) {
    if (item === "-" && (!out.length || out[out.length - 1] === "-")) continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1] === "-") out.pop();
  return out;
}

/** Opens the application context menu at viewport coordinates. */
export function openContextMenu(x: number, y: number, items: MenuNode[]) {
  const usable = tidy(items);
  if (!usable.length) return;
  active = { x, y, items: usable };
  emit();
}

export function closeContextMenu() {
  if (!active) return;
  active = null;
  emit();
}

const MENU_MIN_WIDTH = 214;

function MenuPanel({
  items,
  x,
  y,
  /** Vertical anchor for a flyout, so it lines up with its parent row. */
  submenu,
  onDismiss,
  onBack,
}: {
  items: MenuNode[];
  x: number;
  y: number;
  submenu?: boolean;
  onDismiss: () => void;
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  /** Which row has its flyout open, plus that row's viewport top. */
  const [flyout, setFlyout] = useState<{ index: number; top: number } | null>(null);
  const [cursor, setCursor] = useState(-1);

  const openFlyout = useCallback((index: number) => {
    const row = ref.current?.querySelector<HTMLElement>(`[data-row="${index}"]`);
    if (row) setFlyout({ index, top: row.getBoundingClientRect().top });
  }, []);
  const hoverTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let nx = x;
    let ny = y;

    if (nx + rect.width > window.innerWidth - margin) {
      // Flyouts flip to the left of their parent instead of just sliding.
      nx = submenu ? x - rect.width - MENU_MIN_WIDTH : window.innerWidth - rect.width - margin;
    }
    if (ny + rect.height > window.innerHeight - margin) {
      ny = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ x: Math.max(margin, nx), y: Math.max(margin, ny), ready: true });
  }, [x, y, items, submenu]);

  const selectable = items
    .map((item, i) => (item === "-" || item.disabled ? -1 : i))
    .filter((i) => i >= 0);

  const move = useCallback(
    (delta: number) => {
      if (!selectable.length) return;
      const at = selectable.indexOf(cursor);
      const next = at < 0 ? (delta > 0 ? 0 : selectable.length - 1) : at + delta;
      setCursor(selectable[(next + selectable.length) % selectable.length]);
    },
    [cursor, selectable],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          if (onBack) onBack();
          else onDismiss();
          break;
        case "ArrowDown":
          event.preventDefault();
          event.stopPropagation();
          move(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          move(-1);
          break;
        case "ArrowRight": {
          const node = items[cursor];
          if (node && isGroup(node)) {
            event.preventDefault();
            event.stopPropagation();
            openFlyout(cursor);
          }
          break;
        }
        case "ArrowLeft":
          if (onBack) {
            event.preventDefault();
            event.stopPropagation();
            onBack();
          }
          break;
        case "Enter": {
          const node = items[cursor];
          if (!node || node === "-") break;
          event.preventDefault();
          event.stopPropagation();
          if (isGroup(node)) openFlyout(cursor);
          else {
            onDismiss();
            node.run();
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items, cursor, move, onDismiss, onBack, openFlyout]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const openNode = flyout ? items[flyout.index] : null;

  return (
    <>
      <div
        className="context-menu"
        ref={ref}
        role="menu"
        style={{ left: pos.x, top: pos.y, visibility: pos.ready ? "visible" : "hidden" }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((node, i) => {
          if (node === "-") return <div className="menu-sep" key={`sep-${i}`} />;

          const group = isGroup(node);
          return (
            <button
              key={`${node.label}-${i}`}
              type="button"
              data-row={i}
              role="menuitem"
              disabled={node.disabled}
              aria-haspopup={group || undefined}
              className={[
                "menu-item",
                node.danger ? "is-danger" : "",
                node.disabled ? "is-disabled" : "",
                cursor === i ? "is-cursor" : "",
                group && flyout?.index === i ? "is-open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => {
                if (node.disabled) return;
                setCursor(i);
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(
                  () => (group ? openFlyout(i) : setFlyout(null)),
                  group ? 90 : 160,
                );
              }}
              onClick={() => {
                if (node.disabled) return;
                if (group) {
                  openFlyout(i);
                  return;
                }
                onDismiss();
                (node as MenuCommand).run();
              }}
            >
              <span className="menu-check">
                {isCommand(node) && node.checked ? <Check size={12} strokeWidth={2.6} /> : null}
              </span>
              <span className="menu-label">{node.label}</span>
              {group ? (
                <ChevronRight className="menu-arrow" size={13} strokeWidth={2} />
              ) : node.keys ? (
                <span className="menu-keys">{prettyKeys(node.keys)}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {openNode && isGroup(openNode) && flyout ? (
        <MenuPanel
          key={flyout.index}
          items={openNode.submenu}
          x={pos.x + (ref.current?.offsetWidth ?? MENU_MIN_WIDTH) - 4}
          y={flyout.top - 5}
          submenu
          onDismiss={onDismiss}
          onBack={() => setFlyout(null)}
        />
      ) : null}
    </>
  );
}

/** Single host for every context menu in the app. Mount once, near the root. */
export function ContextMenuHost() {
  const menu = useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  );

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => closeContextMenu();
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <MenuPanel
      key={`${menu.x},${menu.y}`}
      items={menu.items}
      x={menu.x}
      y={menu.y}
      onDismiss={closeContextMenu}
    />
  );
}
