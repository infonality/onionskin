import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { MenuNode } from "../components/ContextMenu";

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Writes a value the way a user would, so React's onChange still fires for
 * controlled inputs.
 */
function setValue(field: Field, value: string, caret: number) {
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.setSelectionRange(caret, caret);
  field.focus();
}

function selectionOf(field: Field) {
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  return { start, end, text: field.value.slice(start, end) };
}

/** A plain clipboard menu for the app's own text inputs. */
export function buildTextFieldMenu(field: Field): MenuNode[] {
  const { start, end, text } = selectionOf(field);
  const readOnly = field.readOnly || field.disabled;

  return [
    {
      label: "Cut",
      keys: "Mod+X",
      disabled: !text || readOnly,
      run: async () => {
        await writeText(text);
        setValue(field, field.value.slice(0, start) + field.value.slice(end), start);
      },
    },
    {
      label: "Copy",
      keys: "Mod+C",
      disabled: !text,
      run: () => void writeText(text),
    },
    {
      label: "Paste",
      keys: "Mod+V",
      disabled: readOnly,
      run: async () => {
        const clip = (await readText()) ?? "";
        if (!clip) return;
        const flat = field instanceof HTMLInputElement ? clip.replace(/[\r\n]+/g, " ") : clip;
        setValue(
          field,
          field.value.slice(0, start) + flat + field.value.slice(end),
          start + flat.length,
        );
      },
    },
    "-",
    {
      label: "Select All",
      keys: "Mod+A",
      disabled: !field.value,
      run: () => {
        field.focus();
        field.select();
      },
    },
    {
      label: "Clear",
      danger: true,
      disabled: !field.value || readOnly,
      run: () => setValue(field, "", 0),
    },
  ];
}
