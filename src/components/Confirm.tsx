import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface ConfirmChoice {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "quiet";
}

interface ConfirmRequest {
  title: string;
  message?: string;
  choices: ConfirmChoice[];
  resolve: (id: string) => void;
}

let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens a modal choice dialog and resolves with the chosen id (or `"cancel"`). */
export function confirmDialog(opts: {
  title: string;
  message?: string;
  choices: ConfirmChoice[];
}): Promise<string> {
  if (current) current.resolve("cancel");
  return new Promise((resolve) => {
    current = {
      ...opts,
      resolve: (id) => {
        current = null;
        emit();
        resolve(id);
      },
    };
    emit();
  });
}

export function ConfirmHost() {
  const request = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (request) setFocusIndex(0);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        request.resolve("cancel");
      } else if (e.key === "Enter") {
        e.preventDefault();
        request.resolve(request.choices[focusIndex]?.id ?? "cancel");
      } else if (e.key === "ArrowRight" || e.key === "Tab") {
        e.preventDefault();
        setFocusIndex((i) => (i + 1) % request.choices.length);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusIndex((i) => (i - 1 + request.choices.length) % request.choices.length);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request, focusIndex]);

  if (!request) return null;

  return (
    <div className="modal-backdrop" onMouseDown={() => request.resolve("cancel")}>
      <div
        className="confirm-panel"
        role="alertdialog"
        aria-modal="true"
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{request.title}</h2>
        {request.message ? <p>{request.message}</p> : null}
        <div className="confirm-actions">
          {request.choices.map((choice, i) => (
            <button
              key={choice.id}
              type="button"
              className={[
                "btn",
                choice.tone === "primary" ? "btn-primary" : "",
                choice.tone === "danger" ? "btn-danger" : "",
                choice.tone === "quiet" ? "btn-quiet" : "",
                i === focusIndex ? "is-focused" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => setFocusIndex(i)}
              onClick={() => request.resolve(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
