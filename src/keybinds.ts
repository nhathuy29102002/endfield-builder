import { tr } from './i18n';
import { hotkeyOf } from './editor/keys';

/**
 * **Phím tắt tuỳ chỉnh** (người dùng 2026-10-13): mọi phím tắt bàn phím của app khai báo ở đây — 3 nhóm Chung / Map /
 * Modeler, mỗi thao tác hai phím (chính + phụ). Người dùng đổi trong Cài đặt → Phím tắt (`ui/keybindsDialog.ts`); chỉ lưu
 * phần **khác mặc định** (`efp:keybinds`). Thao tác chuột chỉ hiện để xem (`LOCKED_ROWS`), riêng "mở thư viện của vật
 * phẩm" (mặc định chuột giữa) đổi được — gán được nút chuột + phím bổ trợ.
 *
 * Tên phím = kết quả `hotkeyOf` (chữ thường, `f1`, `escape`, `space`, `arrowup`, `control`…; nút chuột: `mouse0/1/2`).
 * Sự kiện phím **do app tự gửi** (`isTrusted = false` — nút trên màn hình bấm hộ phím Esc, R…) luôn khớp cả phím mặc
 * định, nên đổi phím không làm hỏng các nút đó.
 */

export type Scope = 'general' | 'map' | 'modeler';

export interface Combo {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type Pair = [Combo | null, Combo | null];

/**
 * - `ctx`: thao tác chỉ chạy trong một hoàn cảnh — hai thao tác khác hoàn cảnh dùng chung phím không bị báo trùng
 *   (Space: đổi chế độ máy khi chỉnh sửa / chạy-dừng khi mô phỏng; mũi tên khi đang xem hướng dẫn).
 * - `looseShift`: khớp cả khi đang giữ Shift (phím di chuyển bản đồ).
 * - `mouse`: được gán nút chuột.
 */
export interface ActionDef {
  id: string;
  scope: Scope;
  label: () => string;
  def: Pair;
  ctx?: 'sim' | 'edit' | 'tutorial';
  looseShift?: boolean;
  mouse?: boolean;
}

/** "Ctrl+Shift+Z" → combo (chỉ dùng cho bảng mặc định bên dưới). */
const k = (s: string): Combo => {
  const parts = s.split('+');
  const key = parts.pop()!.toLowerCase();
  const c: Combo = { key };
  for (const p of parts) {
    if (p === 'Ctrl') c.ctrl = true;
    else if (p === 'Shift') c.shift = true;
    else if (p === 'Alt') c.alt = true;
  }
  return c;
};
const one = (a: string): Pair => [k(a), null];
const two = (a: string, b: string): Pair => [k(a), k(b)];

const pins: ActionDef[] = Array.from({ length: 10 }, (_, i) => ({
  id: `pin${i + 1}`,
  scope: 'general' as const,
  label: () => tr('Cầm máy đã ghim thứ {0}', i + 1),
  def: one(String((i + 1) % 10)),
}));

export const ACTIONS: ActionDef[] = [
  // ---------------------------------------------------------------- chung
  { id: 'palette', scope: 'general', label: () => tr('Đóng / mở bảng chọn máy'), def: two('F1', 'Z') },
  { id: 'machineWin', scope: 'general', label: () => tr('Thu gọn / mở rộng cửa sổ máy đang chọn'), def: one('F2') },
  { id: 'summary', scope: 'general', label: () => tr('Đóng / mở bảng tổng hợp'), def: one('F3') },
  { id: 'save', scope: 'general', label: () => tr('Lưu bản vẽ (đang chọn ⇒ lưu nhóm đó)'), def: one('Ctrl+S') },
  { id: 'library', scope: 'general', label: () => tr('Mở thư viện bản vẽ'), def: one('Ctrl+Shift+S') },
  { id: 'recipes', scope: 'general', label: () => tr('Mở thư viện công thức'), def: one('L') },
  { id: 'itemLib', scope: 'general', label: () => tr('Bấm lên icon vật phẩm: mở trang thư viện của nó'), def: [{ key: 'mouse1' }, null], mouse: true },
  { id: 'undo', scope: 'general', label: () => tr('Hoàn tác'), def: one('Ctrl+Z') },
  { id: 'redo', scope: 'general', label: () => tr('Làm lại'), def: two('Ctrl+Shift+Z', 'Ctrl+Y') },
  { id: 'clipCopy', scope: 'general', label: () => tr('Chép vào bộ nhớ tạm'), def: one('Ctrl+C') },
  { id: 'clipPaste', scope: 'general', label: () => tr('Dán từ bộ nhớ tạm'), def: one('Ctrl+V') },
  { id: 'checklist', scope: 'general', label: () => tr('Checklist: bấm = mở / đóng, giữ = mở trong lúc giữ'), def: one('Control') },
  { id: 'showKeys', scope: 'general', label: () => tr('Giữ: hiện phím tắt trên các nút'), def: one('Alt') },
  ...pins,
  { id: 'tutNext', scope: 'general', label: () => tr('Hướng dẫn: bước tiếp theo'), def: two('Enter', 'ArrowRight'), ctx: 'tutorial' },
  { id: 'tutBack', scope: 'general', label: () => tr('Hướng dẫn: bước trước'), def: one('ArrowLeft'), ctx: 'tutorial' },
  { id: 'tutClose', scope: 'general', label: () => tr('Hướng dẫn: đóng'), def: one('Escape'), ctx: 'tutorial' },
  // ---------------------------------------------------------------- Map
  { id: 'map.up', scope: 'map', label: () => tr('Di chuyển bản vẽ: lên'), def: two('W', 'ArrowUp'), looseShift: true },
  { id: 'map.down', scope: 'map', label: () => tr('Di chuyển bản vẽ: xuống'), def: two('S', 'ArrowDown'), looseShift: true },
  { id: 'map.left', scope: 'map', label: () => tr('Di chuyển bản vẽ: trái'), def: two('A', 'ArrowLeft'), looseShift: true },
  { id: 'map.right', scope: 'map', label: () => tr('Di chuyển bản vẽ: phải'), def: two('D', 'ArrowRight'), looseShift: true },
  { id: 'map.sim', scope: 'map', label: () => tr('Bật / tắt mô phỏng'), def: one('M') },
  { id: 'map.simPlay', scope: 'map', label: () => tr('Mô phỏng: chạy / dừng'), def: one('Space'), ctx: 'sim' },
  { id: 'map.mode', scope: 'map', label: () => tr('Bấm: đổi chế độ máy · giữ + kéo chuột: kéo bản đồ'), def: one('Space'), ctx: 'edit' },
  { id: 'map.cancel', scope: 'map', label: () => tr('Huỷ / thoát công cụ / bỏ chọn'), def: one('Escape') },
  { id: 'map.belt', scope: 'map', label: () => tr('Đặt băng chuyền'), def: one('E') },
  { id: 'map.pipe', scope: 'map', label: () => tr('Đặt ống'), def: one('Q') },
  { id: 'map.rotate', scope: 'map', label: () => tr('Xoay máy'), def: one('R') },
  { id: 'map.move', scope: 'map', label: () => tr('Di chuyển máy / nhóm đang chọn'), def: one('G') },
  { id: 'map.copy', scope: 'map', label: () => tr('Sao chép máy / nhóm đang chọn'), def: one('C') },
  { id: 'map.delete', scope: 'map', label: () => tr('Xoá những gì đang chọn'), def: two('Delete', 'Backspace') },
  { id: 'map.erase', scope: 'map', label: () => tr('Xoá đang chọn / công cụ tẩy'), def: one('F') },
  { id: 'map.toggleOff', scope: 'map', label: () => tr('Bật / tắt máy đang chọn · loại băng / ống kế tiếp'), def: one('Tab') },
  { id: 'map.layer', scope: 'map', label: () => tr('Mặt đất ⇄ trên cao'), def: one('CapsLock') },
  { id: 'map.batch', scope: 'map', label: () => tr('Chế độ chọn hàng loạt'), def: one('X') },
  { id: 'map.labels', scope: 'map', label: () => tr('Hiện / ẩn tên máy'), def: one('N') },
  { id: 'map.camRot', scope: 'map', label: () => tr('Xoay camera 90°'), def: one('Ctrl+R') },
  { id: 'map.camRotBack', scope: 'map', label: () => tr('Xoay camera ngược 90°'), def: one('Ctrl+Shift+R') },
  // ---------------------------------------------------------------- Modeler
  { id: 'md.pen', scope: 'modeler', label: () => tr('Bật / tắt bút vẽ'), def: one('R') },
  { id: 'md.fit', scope: 'modeler', label: () => tr('Vừa màn hình — đưa cả sơ đồ vào giữa'), def: one('F') },
  { id: 'md.move', scope: 'modeler', label: () => tr('Di chuyển nhóm đang chọn'), def: one('M') },
  { id: 'md.copy', scope: 'modeler', label: () => tr('Sao chép nhóm đang chọn'), def: one('C') },
  { id: 'md.delete', scope: 'modeler', label: () => tr('Xoá nhóm đang chọn'), def: two('Delete', 'Backspace') },
  { id: 'md.selectAll', scope: 'modeler', label: () => tr('Chọn tất cả'), def: one('Ctrl+A') },
  { id: 'md.cancel', scope: 'modeler', label: () => tr('Huỷ / bỏ chọn'), def: one('Escape') },
  { id: 'md.pan', scope: 'modeler', label: () => tr('Giữ + kéo chuột: kéo sơ đồ'), def: one('Space') },
];

/** Thao tác chuột — chỉ hiện để xem, không đổi được. */
export const LOCKED_ROWS: { scope: Scope; label: () => string; keys: () => string[] }[] = [
  { scope: 'map', label: () => tr('Chọn máy / ô'), keys: () => [tr('Chuột trái')] },
  { scope: 'map', label: () => tr('Thêm / bớt khỏi vùng chọn'), keys: () => ['Ctrl + ' + tr('Chuột trái')] },
  { scope: 'map', label: () => tr('Chọn vùng'), keys: () => [tr('Kéo chuột trái trên nền')] },
  { scope: 'map', label: () => tr('Nhấc máy lên để di chuyển'), keys: () => [tr('Giữ chuột trái 0,5 s')] },
  { scope: 'map', label: () => tr('Kéo bản đồ'), keys: () => [tr('Kéo chuột phải'), tr('Kéo chuột giữa')] },
  { scope: 'map', label: () => tr('Đang cầm máy: giữ tại chỗ để xoay'), keys: () => [tr('Giữ chuột phải')] },
  { scope: 'map', label: () => tr('Chọn hàng loạt: thoát / kéo hộp bỏ chọn'), keys: () => [tr('Chuột phải')] },
  { scope: 'map', label: () => 'Zoom', keys: () => [tr('Lăn chuột')] },
  { scope: 'modeler', label: () => tr('Chọn nhóm'), keys: () => [tr('Kéo chuột trái trên nền')] },
  { scope: 'modeler', label: () => tr('Kéo sơ đồ / di chuyển máy'), keys: () => [tr('Kéo chuột phải')] },
  { scope: 'modeler', label: () => 'Zoom', keys: () => [tr('Lăn chuột')] },
  { scope: 'modeler', label: () => tr('Nối / máy mới'), keys: () => [tr('Kéo từ cổng')] },
  { scope: 'modeler', label: () => tr('Đổi chỗ cổng'), keys: () => [tr('Giữ cổng rồi kéo')] },
  { scope: 'modeler', label: () => tr('Thêm điểm neo'), keys: () => [tr('Kéo đường nối')] },
  { scope: 'modeler', label: () => tr('Xoá điểm neo / bỏ đường nối'), keys: () => [tr('Chuột phải')] },
  { scope: 'modeler', label: () => tr('Chọn công thức'), keys: () => [tr('Bấm đúp vào máy')] },
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
const STORE = 'efp:keybinds';
export const KEYBINDS_EVENT = 'efp:keybinds';

let custom: Record<string, Pair> = {};
try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE) : null;
  const v = raw ? (JSON.parse(raw) as unknown) : null;
  if (v && typeof v === 'object') custom = v as Record<string, Pair>;
} catch {
  custom = {};
}
const save = (): void => {
  try {
    localStorage.setItem(STORE, JSON.stringify(custom));
  } catch {
    /* không lưu được thì chỉ có tác dụng trong phiên */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(KEYBINDS_EVENT));
};

const validCombo = (c: unknown): c is Combo => !!c && typeof c === 'object' && typeof (c as Combo).key === 'string';

export function bindings(id: string): Pair {
  const c = custom[id];
  if (Array.isArray(c) && c.length === 2) return [validCombo(c[0]) ? c[0] : null, validCombo(c[1]) ? c[1] : null];
  return BY_ID.get(id)?.def ?? [null, null];
}

export function setBinding(id: string, slot: 0 | 1, combo: Combo | null): void {
  const a = BY_ID.get(id);
  if (!a) return;
  const next: Pair = [...bindings(id)];
  next[slot] = combo;
  if (sameCombo(next[0], a.def[0]) && sameCombo(next[1], a.def[1])) delete custom[id];
  else custom[id] = next;
  save();
}

export function resetBindings(scope?: Scope): void {
  if (!scope) custom = {};
  else for (const id of Object.keys(custom)) if (BY_ID.get(id)?.scope === scope) delete custom[id];
  save();
}

export const isCustom = (id: string): boolean => id in custom;

export function sameCombo(a: Combo | null | undefined, b: Combo | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}

const NAMES: Record<string, string> = {
  space: 'Space', escape: 'Esc', delete: 'Del', backspace: 'Backspace', capslock: 'Caps', tab: 'Tab', enter: 'Enter',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta',
  pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End', insert: 'Ins',
};
export function keyName(key: string): string {
  if (key === 'mouse0') return tr('Chuột trái');
  if (key === 'mouse1') return tr('Chuột giữa');
  if (key === 'mouse2') return tr('Chuột phải');
  if (NAMES[key]) return NAMES[key]!;
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  return key.length === 1 ? key.toUpperCase() : key[0]!.toUpperCase() + key.slice(1);
}

export function comboLabel(c: Combo): string {
  const mods = [c.ctrl && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt'].filter(Boolean) as string[];
  return [...mods, keyName(c.key)].join('+');
}

/** Phím chính (không có thì phím phụ) dạng chữ — `''` nếu thao tác chưa gán phím. */
export function keyLabel(id: string): string {
  const [a, b] = bindings(id);
  const c = a ?? b;
  return c ? comboLabel(c) : '';
}

/** `"  (Ctrl+Z)"` để nối vào cuối chú thích nút (shortcutBadges đọc phần trong ngoặc khi giữ Alt). */
export function keyHint(id: string): string {
  const s = keyLabel(id);
  return s ? `  (${s})` : '';
}

const MODS = new Set(['control', 'shift', 'alt', 'meta']);

/** Tổ hợp của một lần bấm phím (dùng khi người dùng gán phím mới). */
export function comboOfKey(e: KeyboardEvent): Combo | null {
  const key = hotkeyOf(e);
  if (!key || key === 'meta') return null;
  const c: Combo = { key };
  if ((e.ctrlKey || e.metaKey) && key !== 'control') c.ctrl = true;
  if (e.shiftKey && key !== 'shift') c.shift = true;
  if (e.altKey && key !== 'alt') c.alt = true;
  return c;
}

export function comboOfMouse(e: MouseEvent): Combo {
  const c: Combo = { key: `mouse${e.button}` };
  if (e.ctrlKey || e.metaKey) c.ctrl = true;
  if (e.shiftKey) c.shift = true;
  if (e.altKey) c.alt = true;
  return c;
}

function comboMatches(c: Combo, key: string, e: KeyboardEvent | MouseEvent, loose: boolean): boolean {
  if (c.key !== key) return false;
  if (key !== 'control' && key !== 'meta' && !!c.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (key !== 'alt' && !!c.alt !== e.altKey) return false;
  if (key !== 'shift' && !loose && !!c.shift !== e.shiftKey) return false;
  return true;
}

/** Tên phím của sự kiện (bàn phím: `hotkeyOf`; chuột: `mouseN`). */
const keyOfEvent = (e: KeyboardEvent | MouseEvent): string | null =>
  'button' in e ? `mouse${(e as MouseEvent).button}` : hotkeyOf(e as KeyboardEvent);

/** Sự kiện này có phải phím / nút của thao tác `id` không. */
export function matches(id: string, e: KeyboardEvent | MouseEvent, key: string | null = keyOfEvent(e)): boolean {
  if (!key) return false;
  const a = BY_ID.get(id);
  if (!a) return false;
  const loose = !!a.looseShift;
  for (const c of bindings(id)) if (c && comboMatches(c, key, e, loose)) return true;
  // phím do app tự gửi (nút trên màn hình bấm hộ) ⇒ luôn nhận phím mặc định
  if (e.isTrusted === false) for (const c of a.def) if (c && comboMatches(c, key, e, loose)) return true;
  return false;
}

/** Chỉ so tên phím (bỏ qua phím bổ trợ) — dùng cho keyup của phím đang giữ. */
export function matchesKey(id: string, key: string | null): boolean {
  if (!key) return false;
  for (const c of bindings(id)) if (c?.key === key) return true;
  return false;
}

/** Thao tác đầu tiên (theo thứ tự `ACTIONS`) trong các nhóm `scopes` khớp sự kiện. */
export function actionOf(e: KeyboardEvent | MouseEvent, scopes: Scope[], skip?: (a: ActionDef) => boolean): string | null {
  const key = keyOfEvent(e);
  if (!key) return null;
  for (const scope of scopes)
    for (const a of ACTIONS) if (a.scope === scope && !skip?.(a) && matches(a.id, e, key)) return a.id;
  return null;
}

const clashScopes = (a: Scope, b: Scope): boolean => a === b || a === 'general' || b === 'general';
const clashCtx = (a: ActionDef, b: ActionDef): boolean => {
  if (a.ctx === b.ctx) return true;
  if (a.ctx === 'tutorial' || b.ctx === 'tutorial') return false;
  return !(a.ctx && b.ctx);
};

/** Các thao tác khác dùng trùng phím `combo` (cùng nhóm hoặc nhóm Chung, cùng hoàn cảnh). */
export function conflictsOf(id: string, combo: Combo | null): ActionDef[] {
  const a = BY_ID.get(id);
  if (!a || !combo) return [];
  const out: ActionDef[] = [];
  for (const b of ACTIONS) {
    if (b.id === id || !clashScopes(a.scope, b.scope) || !clashCtx(a, b)) continue;
    if (bindings(b.id).some((c) => sameCombo(c, combo))) out.push(b);
  }
  return out;
}

export const actionDef = (id: string): ActionDef | undefined => BY_ID.get(id);

/** Đang gõ chữ (ô nhập, vùng soạn thảo) ⇒ phím là của ô đó. */
export function typingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
}

/** Phím (không phải nút chuột) có phải phím bổ trợ đứng một mình không. */
export const isModifierKey = (key: string): boolean => MODS.has(key);
