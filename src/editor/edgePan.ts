/**
 * **Tự cuộn khi rê sát mép** (người dùng 2026-10-26): đang cầm preview máy / nhóm (cả lúc nhấc thả), đang kéo khung chọn
 * vùng (Map lẫn Modeler) hay đang dời máy trong Modeler mà con trỏ / ngón tay vào sát mép khung nhìn ⇒ camera trượt
 * **chậm** về phía mép đó tới khi rê ra khỏi vùng mép hoặc thả.
 *
 *  - Máy tính: vùng mép `EDGE_PX` tính từ **mép khung bản vẽ** vào trong; con trỏ ra ngoài khung (sang bảng chọn máy…)
 *    thì thôi — đi ngang qua mép để sang bảng khác không làm bản đồ trôi.
 *  - Điện thoại: vùng mép rộng hơn (`EDGE_PX_TOUCH`) và tính từ **phần bản đồ còn nhìn thấy** — các bảng nổi che một
 *    phía màn hình (bảng chọn máy, cửa sổ máy, cột công cụ…) thu khung lại (`freeRect`); ngón tay đè lên bảng che đó
 *    cũng tính là sát mép (tốc độ tối đa).
 *
 * Tốc độ tăng dần theo độ sâu vào vùng mép: `MIN_SPEED` → `MAX_SPEED` px/giây (px màn hình).
 */
export const EDGE_PX = 36;
export const EDGE_PX_TOUCH = 64;
const MIN_SPEED = 60;
const MAX_SPEED = 380;

/** Bảng nổi có thể che một phía bản đồ trên điện thoại. */
const COVERS = '.panel.left, .panel.right, .machine-window, .dock, .sim-bar, .touch-actions, .cl-panel, .md-side, .top-float';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Phần khung `base` không bị bảng nổi nào che (điện thoại). Bảng che giữa màn hình (không sát phía nào) thì bỏ qua. */
export function freeRect(base: Rect, covers: Iterable<Rect> = coverRects()): Rect {
  const r = { ...base };
  const w = base.right - base.left;
  const h = base.bottom - base.top;
  for (const c of covers) {
    if (c.right <= r.left || c.left >= r.right || c.bottom <= r.top || c.top >= r.bottom) continue;
    const cw = c.right - c.left;
    const ch = c.bottom - c.top;
    // bảng dọc sát trái / phải (cao ≥ 40 % khung), bảng ngang sát trên / dưới (rộng ≥ 40 % khung)
    if (ch >= h * 0.4 && c.left <= r.left + 8 && c.right < base.left + w * 0.6) r.left = Math.max(r.left, c.right);
    else if (ch >= h * 0.4 && c.right >= r.right - 8 && c.left > base.left + w * 0.4) r.right = Math.min(r.right, c.left);
    else if (cw >= w * 0.4 && c.bottom >= r.bottom - 8 && c.top > base.top + h * 0.4) r.bottom = Math.min(r.bottom, c.top);
    else if (cw >= w * 0.4 && c.top <= r.top + 8 && c.bottom < base.top + h * 0.6) r.top = Math.max(r.top, c.bottom);
  }
  // che gần hết ⇒ dùng lại khung gốc cho khỏi kẹt
  if (r.right - r.left < 80 || r.bottom - r.top < 80) return { ...base };
  return r;
}

function coverRects(): Rect[] {
  if (typeof document === 'undefined') return [];
  const out: Rect[] = [];
  for (const e of document.querySelectorAll<HTMLElement>(COVERS)) {
    if (e.hidden || e.offsetParent === null) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) out.push(r);
  }
  return out;
}

/**
 * Vận tốc trượt **của nội dung** (px màn hình / giây; cộng thẳng vào `camera.pan`) khi con trỏ ở `p` trong khung `rect`.
 * `null` = không ở vùng mép. `outer` (điện thoại): khung gốc — ngón tay nằm giữa `rect` và `outer` (đè lên bảng che) ⇒ tối đa.
 */
export function edgeVelocity(p: { x: number; y: number }, rect: Rect, touch: boolean, outer?: Rect): { x: number; y: number } | null {
  const zone = touch ? EDGE_PX_TOUCH : EDGE_PX;
  const box = outer ?? rect;
  // máy tính: ra ngoài khung là thôi; điện thoại: ra ngoài cả khung gốc là thôi
  if (p.x < box.left || p.x > box.right || p.y < box.top || p.y > box.bottom) return null;
  const depth = (d: number): number => (d >= zone ? 0 : Math.min(1, (zone - d) / zone));
  const speed = (t: number): number => (t <= 0 ? 0 : MIN_SPEED + (MAX_SPEED - MIN_SPEED) * t * t);
  const l = depth(p.x - rect.left);
  const r = depth(rect.right - p.x);
  const t = depth(p.y - rect.top);
  const b = depth(rect.bottom - p.y);
  const vx = speed(l) - speed(r); // sát trái ⇒ nội dung trôi sang phải (thấy thêm phía trái)
  const vy = speed(t) - speed(b);
  return vx === 0 && vy === 0 ? null : { x: vx, y: vy };
}

/** Vận tốc cho khung `el` — tự chọn kiểu máy tính / điện thoại. */
export function edgeVelocityIn(el: Element, p: { x: number; y: number }, touch: boolean): { x: number; y: number } | null {
  const base = el.getBoundingClientRect();
  if (!touch) return edgeVelocity(p, base, false);
  return edgeVelocity(p, freeRect(base), true, base);
}
