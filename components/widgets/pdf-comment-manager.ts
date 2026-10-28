"use client";

/**
 * What pdf.js's editors expect of a "comment manager" (Firefox's is tied to its own dialogs), done as a small store
 * React renders from: the dialog to write a comment, the popup that shows one, and every comment that lives in the
 * editor until the file is saved. Editors and the annotation layer's popups both talk to it through the same calls.
 */

/** The comment carried by an editor (pdf.js's shape). */
export interface CommentData {
  text: string | null;
  richText?: unknown;
  date?: Date | null;
  deleted?: boolean;
  color?: string | null;
  opacity?: number;
}

/** An annotation editor or an annotation-layer popup, as far as comments go. */
export interface CommentTarget {
  uid?: string;
  id?: string;
  pageIndex?: number;
  get comment(): CommentData | string | null;
  set comment(value: CommentData | string | null);
  getData(): {
    id?: string;
    pageIndex?: number;
    rect?: number[];
    contentsObj?: { str?: string } | null;
    creationDate?: string | null;
    modificationDate?: string | Date | null;
    color?: string | ArrayLike<number> | null;
    opacity?: number;
    titleObj?: { str?: string } | null;
  };
  editComment?: (options?: object) => void | Promise<void>;
  commentPopupPosition?: number[] | null;
  commentButtonPosition?: number[] | null;
  parentBoundingClientRect?: DOMRect;
  commentButtonColor?: string | null;
  hasComment?: boolean;
  div?: HTMLElement | null;
}

export interface LiveComment {
  uid: string;
  pageIndex: number;
  text: string;
  date: Date | null;
  color: string | null;
  rect: number[] | null;
  target: CommentTarget;
}

export interface DialogState {
  target: CommentTarget;
  /** Viewport coordinates. */
  x: number;
  y: number;
  text: string;
  isNew: boolean;
}

export interface PopupState {
  target: CommentTarget;
  x: number;
  y: number;
  pinned: boolean;
  editable: boolean;
}

export interface CommentSnapshot {
  live: LiveComment[];
  dialog: DialogState | null;
  popup: PopupState | null;
}

const EMPTY: CommentSnapshot = { live: [], dialog: null, popup: null };

export function commentText(target: CommentTarget): string {
  const c = target.comment;
  if (typeof c === "string") return c;
  return c?.text ?? "";
}

const toHex = (c: string | ArrayLike<number> | null | undefined): string | null => {
  if (!c) return null;
  if (typeof c === "string") return c;
  if (c.length < 3) return null;
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
};

export class BenchCommentManager {
  private live = new Map<string, LiveComment>();
  private listeners = new Set<() => void>();
  private snap: CommentSnapshot = EMPTY;
  private dialog: DialogState | null = null;
  private popup: PopupState | null = null;
  /**
   * The element the dialog renders into: pdf.js points its comment buttons' aria-controls at it and keeps keyboard
   * focus inside it, so it must be a real element even while no dialog shows.
   */
  dialogElement: HTMLElement | null = null;
  uiManager: unknown = null;

  /** The widget hands over the element its dialog renders into. */
  setDialogHost(el: HTMLElement | null) {
    this.dialogElement = el;
  }

  /* ------------------------------------------------ the contract pdf.js calls */

  setSidebarUiManager(uiManager: unknown) {
    this.uiManager = uiManager;
  }

  showDialog(_uiManager: unknown, target: CommentTarget, posX: number, posY: number): Promise<void> {
    const text = commentText(target);
    this.popup = null;
    this.dialog = { target, x: posX, y: posY, text, isNew: !text };
    this.emit();
    return Promise.resolve();
  }

  updateComment(data: ReturnType<CommentTarget["getData"]> & { id?: string }) {
    const uid = data.id;
    if (!uid || typeof data.pageIndex !== "number") return;
    const text = data.contentsObj?.str ?? "";
    const existing = this.live.get(uid);
    const target = existing?.target ?? this.dialog?.target ?? this.popup?.target;
    if (!target) return;
    const when = data.modificationDate;
    this.live.set(uid, {
      uid,
      pageIndex: data.pageIndex,
      text,
      date: when instanceof Date ? when : existing?.date ?? new Date(),
      color: toHex(data.color),
      rect: data.rect ?? null,
      target,
    });
    this.emit();
  }

  removeComments(ids: string[]) {
    for (const id of ids) this.live.delete(id);
    if (this.dialog && ids.includes(this.dialog.target.uid ?? "")) this.dialog = null;
    if (this.popup && ids.includes(this.popup.target.uid ?? "")) this.popup = null;
    this.emit();
  }

  toggleCommentPopup(target: CommentTarget, isSelected: boolean, visibility?: boolean, isEditable = true) {
    const same = this.popup?.target === target;
    if (isSelected) {
      if (same && this.popup?.pinned) this.popup = null;
      else this.popup = { target, ...this.popupPosition(target), pinned: true, editable: isEditable };
    } else if (visibility === true) {
      if (!this.popup?.pinned) this.popup = { target, ...this.popupPosition(target), pinned: false, editable: isEditable };
    } else if (visibility === false) {
      if (same && !this.popup?.pinned) this.popup = null;
    } else if (same) this.popup = null;
    this.emit();
  }

  destroyPopup() {
    this.popup = null;
    this.emit();
  }

  updatePopupColor() {
    this.emit();
  }

  makeCommentColor(color: string | null, opacity: number | null): string | null {
    if (!color) return null;
    return `color-mix(in srgb, ${color} ${Math.round((opacity ?? 1) * 100)}%, white)`;
  }

  showSidebar() {}
  hideSidebar() {}

  destroy() {
    this.live.clear();
    this.dialog = null;
    this.popup = null;
    this.uiManager = null;
    this.emit();
  }

  /* ------------------------------------------------------- for the widget */

  private popupPosition(target: CommentTarget): { x: number; y: number } {
    const parent = target.parentBoundingClientRect;
    const pos = target.commentPopupPosition ?? (target.commentButtonPosition ? target.commentButtonPosition.map((v) => (v > 1 ? v / 100 : v)) : null);
    if (parent && pos && pos.length >= 2) return { x: parent.x + pos[0] * parent.width, y: parent.y + pos[1] * parent.height };
    const div = target.div;
    if (div) {
      const r = div.getBoundingClientRect();
      return { x: r.right, y: r.bottom };
    }
    return { x: 0, y: 0 };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.snap;

  private emit() {
    this.snap = { live: [...this.live.values()].sort((a, b) => a.pageIndex - b.pageIndex), dialog: this.dialog, popup: this.popup };
    for (const l of this.listeners) l();
  }

  /** The dialog's text was confirmed: the editor takes the comment (an empty text removes it). */
  saveDialog(text: string) {
    const d = this.dialog;
    if (!d) return;
    const trimmed = text.trim();
    // The setter calls back into updateComment, which finds the target through the still-open dialog.
    d.target.comment = trimmed ? trimmed : null;
    this.dialog = null;
    this.emit();
  }

  cancelDialog() {
    this.dialog = null;
    this.emit();
  }

  /** Opens the dialog on a target (its own position, from its comment button). */
  edit(target: CommentTarget) {
    this.popup = null;
    if (target.editComment) void target.editComment();
    else {
      const { x, y } = this.popupPosition(target);
      void this.showDialog(null, target, x, y);
    }
  }

  deleteComment(target: CommentTarget) {
    this.popup = null;
    target.comment = null;
    this.emit();
  }

  /** Pin the popup on a target (from the comments list). */
  show(target: CommentTarget) {
    this.popup = { target, ...this.popupPosition(target), pinned: true, editable: true };
    this.emit();
  }

  closePopup() {
    if (!this.popup) return;
    this.popup = null;
    this.emit();
  }

  get hasLive() {
    return this.live.size > 0;
  }
}
