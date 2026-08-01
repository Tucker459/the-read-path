/**
 * B+tree pages and the structural operations on them.
 *
 * Everything here is pure and works on a flat page table rather than on linked
 * objects. That is not an implementation detail borrowed from functional
 * programming — it is what a real B-tree does. Nodes are disk pages addressed
 * by number, and "following a pointer" means reading a page. Modelling it this
 * way makes page reads and writes countable, which is the only honest way to
 * compare this against an LSM-tree later.
 */

export type PageId = number

export interface LeafPage {
  kind: 'leaf'
  id: PageId
  keys: string[]
  values: string[]
  /** Leaves are chained, which is what makes a range scan cheap. */
  next: PageId | null
}

export interface InternalPage {
  kind: 'internal'
  id: PageId
  /** Separators. `keys[i]` divides `children[i]` from `children[i + 1]`. */
  keys: string[]
  children: PageId[]
}

export type Page = LeafPage | InternalPage
export type PageMap = Record<PageId, Page>

export interface Tree {
  pages: PageMap
  rootId: PageId
  nextPageId: PageId
  height: number
}

export function emptyTree(): Tree {
  return {
    pages: { 1: { kind: 'leaf', id: 1, keys: [], values: [], next: null } },
    rootId: 1,
    nextPageId: 2,
    height: 1,
  }
}

export function page(pages: PageMap, id: PageId): Page {
  const found = pages[id]
  if (found === undefined) throw new Error(`page ${id} not found`)
  return found
}

export function minKeys(maxKeys: number): number {
  return Math.floor(maxKeys / 2)
}

/** Index of the child to follow for `key`. */
export function childIndexFor(node: InternalPage, key: string): number {
  let index = 0
  while (index < node.keys.length && key >= (node.keys[index] as string)) index += 1
  return index
}

/** Position at which `key` belongs in a sorted key list. */
function insertionPoint(keys: readonly string[], key: string): number {
  let index = 0
  while (index < keys.length && (keys[index] as string) < key) index += 1
  return index
}

/** The child of `node` to visit next when looking for `key`. */
export function nextChild(pages: PageMap, nodeId: PageId, key: string): PageId {
  const node = page(pages, nodeId)
  if (node.kind === 'leaf') throw new Error('nextChild called on a leaf')
  return node.children[childIndexFor(node, key)] as PageId
}

/** Every page from the root down to the leaf that would hold `key`. */
export function pathToLeaf(pages: PageMap, rootId: PageId, key: string): PageId[] {
  const path: PageId[] = [rootId]
  let current = page(pages, rootId)
  while (current.kind === 'internal') {
    const childId = current.children[childIndexFor(current, key)] as PageId
    path.push(childId)
    current = page(pages, childId)
  }
  return path
}

export function leafValue(leaf: LeafPage, key: string): string | null {
  const index = leaf.keys.indexOf(key)
  return index === -1 ? null : (leaf.values[index] as string)
}

/** Insert or overwrite in a leaf. Returns the same map if nothing changed. */
export function writeToLeaf(pages: PageMap, leafId: PageId, key: string, value: string): PageMap {
  const leaf = page(pages, leafId) as LeafPage
  const existing = leaf.keys.indexOf(key)
  if (existing !== -1) {
    const values = [...leaf.values]
    values[existing] = value
    return { ...pages, [leafId]: { ...leaf, values } }
  }
  const at = insertionPoint(leaf.keys, key)
  return {
    ...pages,
    [leafId]: {
      ...leaf,
      keys: [...leaf.keys.slice(0, at), key, ...leaf.keys.slice(at)],
      values: [...leaf.values.slice(0, at), value, ...leaf.values.slice(at)],
    },
  }
}

export function removeFromLeaf(pages: PageMap, leafId: PageId, key: string): PageMap {
  const leaf = page(pages, leafId) as LeafPage
  const at = leaf.keys.indexOf(key)
  if (at === -1) return pages
  return {
    ...pages,
    [leafId]: {
      ...leaf,
      keys: [...leaf.keys.slice(0, at), ...leaf.keys.slice(at + 1)],
      values: [...leaf.values.slice(0, at), ...leaf.values.slice(at + 1)],
    },
  }
}

export function isOverfull(node: Page, maxKeys: number): boolean {
  return node.keys.length > maxKeys
}

export function isUnderfull(node: Page, maxKeys: number): boolean {
  return node.keys.length < minKeys(maxKeys)
}

export interface SplitResult extends Tree {
  /** Pages written by the split, for the I/O counter. */
  written: PageId[]
}

/**
 * Split the page at the end of `path`, pushing a separator into its parent.
 *
 * The asymmetry between the two cases is the defining feature of a B+tree.
 * Splitting a leaf **copies** the first key of the new right page upward —
 * every key must remain present in some leaf, because leaves hold all the
 * data. Splitting an internal page **moves** the middle key upward instead;
 * separators are signposts, not data, so nothing is lost by removing one.
 */
export function splitPath(tree: Tree, path: PageId[], maxKeys: number): SplitResult {
  void maxKeys
  const nodeId = path[path.length - 1] as PageId
  const node = page(tree.pages, nodeId)
  const rightId = tree.nextPageId
  const written: PageId[] = [nodeId, rightId]

  let pages: PageMap
  let separator: string

  if (node.kind === 'leaf') {
    const mid = Math.ceil(node.keys.length / 2)
    const left: LeafPage = {
      ...node,
      keys: node.keys.slice(0, mid),
      values: node.values.slice(0, mid),
      next: rightId,
    }
    const right: LeafPage = {
      kind: 'leaf',
      id: rightId,
      keys: node.keys.slice(mid),
      values: node.values.slice(mid),
      next: node.next,
    }
    separator = right.keys[0] as string
    pages = { ...tree.pages, [nodeId]: left, [rightId]: right }
  } else {
    const mid = Math.floor(node.keys.length / 2)
    separator = node.keys[mid] as string
    const left: InternalPage = {
      ...node,
      keys: node.keys.slice(0, mid),
      children: node.children.slice(0, mid + 1),
    }
    const right: InternalPage = {
      kind: 'internal',
      id: rightId,
      keys: node.keys.slice(mid + 1),
      children: node.children.slice(mid + 1),
    }
    pages = { ...tree.pages, [nodeId]: left, [rightId]: right }
  }

  // Splitting the root is the only way a B+tree gets taller, and it grows from
  // the top rather than the bottom — which is what keeps every leaf at the
  // same depth.
  if (path.length === 1) {
    const newRootId = tree.nextPageId + 1
    written.push(newRootId)
    return {
      pages: {
        ...pages,
        [newRootId]: { kind: 'internal', id: newRootId, keys: [separator], children: [nodeId, rightId] },
      },
      rootId: newRootId,
      nextPageId: tree.nextPageId + 2,
      height: tree.height + 1,
      written,
    }
  }

  const parentId = path[path.length - 2] as PageId
  const parent = page(pages, parentId) as InternalPage
  const at = insertionPoint(parent.keys, separator)
  written.push(parentId)

  return {
    pages: {
      ...pages,
      [parentId]: {
        ...parent,
        keys: [...parent.keys.slice(0, at), separator, ...parent.keys.slice(at)],
        children: [...parent.children.slice(0, at + 1), rightId, ...parent.children.slice(at + 1)],
      },
    },
    rootId: tree.rootId,
    nextPageId: tree.nextPageId + 1,
    height: tree.height,
    written,
  }
}

export type RebalanceKind = 'borrow-left' | 'borrow-right' | 'merge-left' | 'merge-right' | 'shrink-root' | 'none'

export interface RebalanceResult extends Tree {
  kind: RebalanceKind
  written: PageId[]
  freed: PageId[]
}

function unchanged(tree: Tree, kind: RebalanceKind = 'none'): RebalanceResult {
  return { ...tree, kind, written: [], freed: [] }
}

/**
 * Repair an underfull page at the end of `path`.
 *
 * Borrowing is preferred over merging because it touches fewer pages and
 * cannot cascade. A merge removes a separator from the parent, which can leave
 * the parent underfull in turn — the mirror image of a split rippling upward.
 */
export function rebalancePath(tree: Tree, path: PageId[], maxKeys: number): RebalanceResult {
  const nodeId = path[path.length - 1] as PageId
  const node = page(tree.pages, nodeId)

  if (path.length === 1) {
    // The root is allowed to be underfull. It is only a problem when an
    // internal root has run out of separators entirely, at which point the
    // tree loses a level.
    if (node.kind === 'internal' && node.keys.length === 0) {
      const onlyChild = node.children[0] as PageId
      const pages = { ...tree.pages }
      delete pages[nodeId]
      return {
        pages,
        rootId: onlyChild,
        nextPageId: tree.nextPageId,
        height: tree.height - 1,
        kind: 'shrink-root',
        written: [onlyChild],
        freed: [nodeId],
      }
    }
    return unchanged(tree)
  }

  if (!isUnderfull(node, maxKeys)) return unchanged(tree)

  const parentId = path[path.length - 2] as PageId
  const parent = page(tree.pages, parentId) as InternalPage
  const index = parent.children.indexOf(nodeId)
  const leftId = index > 0 ? (parent.children[index - 1] as PageId) : null
  const rightId = index < parent.children.length - 1 ? (parent.children[index + 1] as PageId) : null
  const left = leftId === null ? null : page(tree.pages, leftId)
  const right = rightId === null ? null : page(tree.pages, rightId)
  const spare = (sibling: Page | null) => sibling !== null && sibling.keys.length > minKeys(maxKeys)

  if (spare(left)) return borrowFromLeft(tree, node, left as Page, parent, index)
  if (spare(right)) return borrowFromRight(tree, node, right as Page, parent, index)
  if (left !== null) return mergePair(tree, left, node, parent, index - 1, 'merge-left')
  if (right !== null) return mergePair(tree, node, right, parent, index, 'merge-right')
  return unchanged(tree)
}

function borrowFromLeft(
  tree: Tree,
  node: Page,
  left: Page,
  parent: InternalPage,
  index: number,
): RebalanceResult {
  const separatorAt = index - 1
  let updatedNode: Page
  let updatedLeft: Page
  let newSeparator: string

  if (node.kind === 'leaf' && left.kind === 'leaf') {
    const key = left.keys[left.keys.length - 1] as string
    const value = left.values[left.values.length - 1] as string
    updatedLeft = { ...left, keys: left.keys.slice(0, -1), values: left.values.slice(0, -1) }
    updatedNode = { ...node, keys: [key, ...node.keys], values: [value, ...node.values] }
    newSeparator = key
  } else {
    const internalNode = node as InternalPage
    const internalLeft = left as InternalPage
    // The separator rotates: the parent's key drops into the node, and the
    // sibling's last key rises to take its place.
    newSeparator = internalLeft.keys[internalLeft.keys.length - 1] as string
    updatedLeft = {
      ...internalLeft,
      keys: internalLeft.keys.slice(0, -1),
      children: internalLeft.children.slice(0, -1),
    }
    updatedNode = {
      ...internalNode,
      keys: [parent.keys[separatorAt] as string, ...internalNode.keys],
      children: [internalLeft.children[internalLeft.children.length - 1] as PageId, ...internalNode.children],
    }
  }

  const keys = [...parent.keys]
  keys[separatorAt] = newSeparator

  return {
    pages: {
      ...tree.pages,
      [updatedNode.id]: updatedNode,
      [updatedLeft.id]: updatedLeft,
      [parent.id]: { ...parent, keys },
    },
    rootId: tree.rootId,
    nextPageId: tree.nextPageId,
    height: tree.height,
    kind: 'borrow-left',
    written: [updatedNode.id, updatedLeft.id, parent.id],
    freed: [],
  }
}

function borrowFromRight(
  tree: Tree,
  node: Page,
  right: Page,
  parent: InternalPage,
  index: number,
): RebalanceResult {
  let updatedNode: Page
  let updatedRight: Page
  let newSeparator: string

  if (node.kind === 'leaf' && right.kind === 'leaf') {
    const key = right.keys[0] as string
    const value = right.values[0] as string
    updatedRight = { ...right, keys: right.keys.slice(1), values: right.values.slice(1) }
    updatedNode = { ...node, keys: [...node.keys, key], values: [...node.values, value] }
    newSeparator = updatedRight.keys[0] as string
  } else {
    const internalNode = node as InternalPage
    const internalRight = right as InternalPage
    newSeparator = internalRight.keys[0] as string
    updatedRight = { ...internalRight, keys: internalRight.keys.slice(1), children: internalRight.children.slice(1) }
    updatedNode = {
      ...internalNode,
      keys: [...internalNode.keys, parent.keys[index] as string],
      children: [...internalNode.children, internalRight.children[0] as PageId],
    }
  }

  const keys = [...parent.keys]
  keys[index] = newSeparator

  return {
    pages: {
      ...tree.pages,
      [updatedNode.id]: updatedNode,
      [updatedRight.id]: updatedRight,
      [parent.id]: { ...parent, keys },
    },
    rootId: tree.rootId,
    nextPageId: tree.nextPageId,
    height: tree.height,
    kind: 'borrow-right',
    written: [updatedNode.id, updatedRight.id, parent.id],
    freed: [],
  }
}

/** Merge `right` into `left`, dropping the separator that divided them. */
function mergePair(
  tree: Tree,
  left: Page,
  right: Page,
  parent: InternalPage,
  separatorAt: number,
  kind: RebalanceKind,
): RebalanceResult {
  let merged: Page
  if (left.kind === 'leaf' && right.kind === 'leaf') {
    merged = {
      ...left,
      keys: [...left.keys, ...right.keys],
      values: [...left.values, ...right.values],
      next: right.next,
    }
  } else {
    const internalLeft = left as InternalPage
    const internalRight = right as InternalPage
    // The separator is not discarded — it becomes an ordinary key in the
    // merged page, because it still divides the two halves' children.
    merged = {
      ...internalLeft,
      keys: [...internalLeft.keys, parent.keys[separatorAt] as string, ...internalRight.keys],
      children: [...internalLeft.children, ...internalRight.children],
    }
  }

  const pages = { ...tree.pages, [merged.id]: merged }
  delete pages[right.id]

  return {
    pages: {
      ...pages,
      [parent.id]: {
        ...parent,
        keys: [...parent.keys.slice(0, separatorAt), ...parent.keys.slice(separatorAt + 1)],
        children: [...parent.children.slice(0, separatorAt + 1), ...parent.children.slice(separatorAt + 2)],
      },
    },
    rootId: tree.rootId,
    nextPageId: tree.nextPageId,
    height: tree.height,
    kind,
    written: [merged.id, parent.id],
    freed: [right.id],
  }
}

/** Every key in the tree, in order, walked along the leaf chain. */
export function scanAll(pages: PageMap, rootId: PageId): { key: string; value: string }[] {
  let current = page(pages, rootId)
  while (current.kind === 'internal') current = page(pages, current.children[0] as PageId)

  const out: { key: string; value: string }[] = []
  let leaf: LeafPage | null = current
  while (leaf !== null) {
    leaf.keys.forEach((key, index) => out.push({ key, value: leaf?.values[index] as string }))
    leaf = leaf.next === null ? null : (page(pages, leaf.next) as LeafPage)
  }
  return out
}

/** All leaves, left to right, following the chain. */
export function leafChain(pages: PageMap, rootId: PageId): LeafPage[] {
  let current = page(pages, rootId)
  while (current.kind === 'internal') current = page(pages, current.children[0] as PageId)
  const out: LeafPage[] = []
  let leaf: LeafPage | null = current
  while (leaf !== null) {
    out.push(leaf)
    leaf = leaf.next === null ? null : (page(pages, leaf.next) as LeafPage)
  }
  return out
}
