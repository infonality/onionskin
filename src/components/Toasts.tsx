import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "../state/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts
      .filter((t) => !t.sticky)
      .map((t) => window.setTimeout(() => dismiss(t.id), t.tone === "error" ? 7000 : 3200));
    return () => timers.forEach(window.clearTimeout);
  }, [toasts, dismiss]);

  if (!toasts.length) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast is-${toast.tone}`}>
          {toast.tone === "error" ? (
            <AlertTriangle size={15} strokeWidth={1.9} />
          ) : (
            <Check size={15} strokeWidth={2.2} />
          )}
          <span>{toast.message}</span>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
