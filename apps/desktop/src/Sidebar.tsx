import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { SidebarIcon } from "./SidebarIcon";
import { Popover } from "@talkkeeper/ui";
import { data } from "./api";
export type View = { kind: "home" | "note" | "today" | "chat" | "people" | "companies" | "trash" | "settings" | "setup" } | { kind: "space"; folder: string };
type Folder = { id: string; name: string };
export function Sidebar({view, onNavigate, folders, setFolders, counts, children, onError, refresh}: { view: View; onNavigate: (v: View) => void; folders: Folder[]; setFolders: (f: Folder[]) => void; counts: {people: number; companies: number}; children: ReactNode; onError: (e: unknown) => void; refresh: () => Promise<void> }) {
const folder = view.kind === "space" ? view.folder : "";
const setFolder = (folder: string) => onNavigate({kind:"space",folder});
const fail = onError;
  const [folderEdit, setFolderEdit] = useState<{
    id: string;
    name: string;
    existing: boolean;
  } | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<{
    id: string;
    name: string;
  } | null>(null);

const link = (kind: View["kind"], label: string) => <button className="quiet" aria-current={view.kind === kind ? "page" : undefined} onClick={() => onNavigate({kind} as View)}><SidebarIcon name={label} />{label}</button>;
return <aside className="sidebar"><nav aria-label="Main">{link("home", "Home")}{link("chat", "Ask your notes")}{link("today", "Today")}
          <div className="folder-heading">
            <h3>Spaces</h3>
            <button
              className="quiet"
              aria-label="New folder"
              title="New folder"
              onClick={() =>
                setFolderEdit({
                  id: crypto.randomUUID(),
                  name: "",
                  existing: false,
                })
              }
            >
              +
            </button>
          </div>
          <button
            className="quiet"
            aria-current={view.kind === "space" && !folder ? "page" : undefined}
            onClick={() => onNavigate({ kind: "space", folder: "" })}
          >
            <SidebarIcon name="Notes" />All notes
          </button>
          {!folders.length && <small>Group notes into folders.</small>}
          {folders.map((f) => (
            <div className="folder-row" key={f.id}>
              <button
                className="quiet"
                aria-current={folder === f.id ? "page" : undefined}
                onClick={() => onNavigate({ kind: "space", folder: f.id })}
              >
                <SidebarIcon name="Folder" /><span className="folder-name" title={f.name}>{f.name}</span>
              </button>
              <Popover label={`Folder options for ${f.name}`}>
                <button onClick={() => setFolderEdit({ ...f, existing: true })}>
                  Rename
                </button>
                <button onClick={() => setDeleteFolder(f)}>
                  Delete folder…
                </button>
              </Popover>
            </div>
          ))}
          {folderEdit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!folderEdit.name.trim()) return;
                void data("save_folder", {
                  folder: {
                    id: folderEdit.id,
                    name: folderEdit.name.trim(),
                    parent_id: null,
                  },
                  update: folderEdit.existing,
                })
                  .then(() => data<typeof folders>("folders"))
                  .then(setFolders)
                  .then(() => setFolderEdit(null))
                  .catch(fail);
              }}
            >
              <input
                autoFocus
                aria-label="Folder name"
                value={folderEdit.name}
                onChange={(e) =>
                  setFolderEdit({ ...folderEdit, name: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") setFolderEdit(null);
                }}
              />
              <button type="submit">Apply</button>
              <button type="button" onClick={() => setFolderEdit(null)}>
                Cancel
              </button>
            </form>
          )}
          {deleteFolder && (
            <Modal onClose={() => setDeleteFolder(null)}
              role="alertdialog"
              aria-label={`Delete the folder "${deleteFolder.name}"?`}
            >
              <h3>Delete the folder "{deleteFolder.name}"?</h3>
              <p>The notes inside are kept and move to All notes.</p>
              <button
                onClick={() =>
                  void data("delete_folder", { id: deleteFolder.id })
                    .then(() => {
                      setFolder("");
                      setDeleteFolder(null);
                      return data<typeof folders>("folders");
                    })
                    .then(setFolders)
                    .then(refresh)
                    .catch(fail)
                }
              >
                Delete folder
              </button>
              <button onClick={() => setDeleteFolder(null)}>Cancel</button>
            </Modal>
          )}

{counts.people > 0 && link("people", "People")}{counts.companies > 0 && link("companies", "Companies")}
<div className="sidebar-bottom">{link("settings", "Settings")}{link("trash", "Trash")}{children}</div></nav></aside>;
}
