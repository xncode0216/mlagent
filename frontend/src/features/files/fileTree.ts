import type { FileItem } from "../../lib/api";

export function getParentPath(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

export function getDepth(path: string) {
  return Math.max(0, path.split("/").length - 1);
}

function isVisiblePath(path: string, expandedFolders: string[]) {
  const parent = getParentPath(path);
  if (!parent) return true;
  const parts = parent.split("/");
  return parts.every((_, index) => expandedFolders.includes(parts.slice(0, index + 1).join("/")));
}

function compareTreeItems(a: FileItem, b: FileItem) {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function buildVisibleTree(items: FileItem[], expandedFolders: string[]) {
  const visibleItems = items.filter((item) => item.path !== "sessions").filter((item) => isVisiblePath(item.path, expandedFolders));
  const childrenByParent = new Map<string, FileItem[]>();

  for (const item of visibleItems) {
    const parent = getParentPath(item.path);
    const children = childrenByParent.get(parent) ?? [];
    children.push(item);
    childrenByParent.set(parent, children);
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareTreeItems);
  }

  const orderedItems: FileItem[] = [];
  const seen = new Set<string>();

  function appendChildren(parent: string) {
    for (const child of childrenByParent.get(parent) ?? []) {
      if (seen.has(child.path)) continue;
      seen.add(child.path);
      orderedItems.push(child);
      if (child.type === "directory" && expandedFolders.includes(child.path)) {
        appendChildren(child.path);
      }
    }
  }

  appendChildren("");

  for (const item of visibleItems.sort((a, b) => a.path.localeCompare(b.path))) {
    if (!seen.has(item.path)) {
      orderedItems.push(item);
    }
  }

  return orderedItems;
}
