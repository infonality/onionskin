import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface DocumentPayload {
  path: string;
  name: string;
  content: string;
  modified: number;
  lineEnding: "lf" | "crlf";
}

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  isMarkdown: boolean;
  hasChildren: boolean;
  size: number;
  modified: number;
}

export interface SearchHit {
  path: string;
  name: string;
  line: number;
  text: string;
}

export interface StartupInfo {
  files: string[];
  home: string;
  documents: string;
  platform: string;
}

export const readDocument = (path: string) =>
  invoke<DocumentPayload>("read_document", { path });

export const writeDocument = (
  path: string,
  content: string,
  lineEnding: "lf" | "crlf",
) => invoke<number>("write_document", { req: { path, content, lineEnding } });

export const fileMtime = (path: string) =>
  invoke<number | null>("file_mtime", { path });

export const listDirectory = (path: string, showAll = false) =>
  invoke<FsEntry[]>("list_directory", { path, showAll });

export const scanMarkdownFiles = (root: string, limit = 2000) =>
  invoke<FsEntry[]>("scan_markdown_files", { root, limit });

export const searchInFolder = (root: string, query: string, limit = 200) =>
  invoke<SearchHit[]>("search_in_folder", { root, query, limit });

export const createDocumentFile = (dir: string, name: string) =>
  invoke<string>("create_document", { dir, name });

export const createFolderEntry = (dir: string, name: string) =>
  invoke<string>("create_folder", { dir, name });

export const renameEntry = (path: string, newName: string) =>
  invoke<string>("rename_entry", { path, newName });

export const trashEntry = (path: string) => invoke<void>("trash_entry", { path });

export const revealEntry = (path: string) => invoke<void>("reveal_entry", { path });

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

export const getStartupInfo = () => invoke<StartupInfo>("startup_info");

export const loadPrefs = () => invoke<Record<string, unknown>>("load_prefs");

export const savePrefs = (prefs: Record<string, unknown>) =>
  invoke<void>("save_prefs", { prefs });

export const signalReady = () => invoke<void>("ready");

export const confirmClose = () => invoke<void>("confirm_close");

/** Maps a local filesystem path to a URL the webview is allowed to load. */
export function assetUrl(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}
