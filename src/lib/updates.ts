import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { confirmDialog } from "../components/Confirm";
import { persistPrefs, saveDirtyToDisk } from "../state/actions";
import { useStore } from "../state/store";

function reason(error: unknown): string {
  const text =
    typeof error === "string" ? error : ((error as Error)?.message ?? String(error));
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Trims release notes to something a dialog can show without scrolling. */
function summarise(update: Update): string {
  const body = (update.body ?? "").trim();
  const head = `You have ${update.currentVersion}.`;
  if (!body) return head;
  const short = body.length > 400 ? body.slice(0, 400).trimEnd() + "…" : body;
  return `${head}\n\n${short}`;
}

let inFlight = false;

/**
 * Downloads and installs, keeping the user informed through one sticky toast.
 * The installer closes the app, so anything unsaved is flushed first.
 */
async function install(update: Update) {
  const store = useStore.getState();
  const toast = store.pushToast(`Downloading ${update.version}…`, "info", true);

  try {
    await saveDirtyToDisk();
    await persistPrefs(true);

    let total = 0;
    let received = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        const pct = total ? Math.min(100, Math.round((received / total) * 100)) : null;
        useStore.getState().updateToast(toast, {
          message:
            pct === null
              ? `Downloading ${update.version}…`
              : `Downloading ${update.version} — ${pct}%`,
        });
      } else if (event.event === "Finished") {
        useStore.getState().updateToast(toast, { message: `Installing ${update.version}…` });
      }
    });

    useStore.getState().dismissToast(toast);
    await relaunch();
  } catch (error) {
    useStore.getState().dismissToast(toast);
    useStore
      .getState()
      .pushToast(`Update to ${update.version} failed: ${reason(error)}`, "error");
  }
}

/**
 * Looks for a newer release.
 *
 * `silent` is for the check on launch: no network, no published release, or a
 * repository the machine cannot reach all land in the same catch, and none of
 * them are worth interrupting someone's writing for.
 */
export async function checkForUpdates({ silent }: { silent: boolean }) {
  if (inFlight) return;
  inFlight = true;

  try {
    const update = await check();

    if (!update) {
      if (!silent) useStore.getState().pushToast("Onionskin is up to date.");
      return;
    }

    // The installer shuts the app down. A new document that has never been
    // saved has nowhere to go, so say so before starting rather than after.
    const unsaved = useStore
      .getState()
      .docs.filter((d) => !d.path && d.text !== d.savedText);
    const warning = unsaved.length
      ? `\n\n${unsaved.length} new document${unsaved.length > 1 ? "s have" : " has"} never been saved. Save ${unsaved.length > 1 ? "them" : "it"} first — installing closes the app.`
      : "";

    const answer = await confirmDialog({
      title: `Onionskin ${update.version} is available`,
      message: summarise(update) + warning,
      choices: [
        { id: "install", label: "Download and Install", tone: "primary" },
        { id: "later", label: "Later", tone: "quiet" },
      ],
    });

    if (answer === "install") await install(update);
  } catch (error) {
    if (!silent) {
      useStore.getState().pushToast(`Could not check for updates: ${reason(error)}`, "error");
    }
  } finally {
    inFlight = false;
  }
}
