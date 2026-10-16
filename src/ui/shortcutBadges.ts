import { keyLabel, matchesKey } from '../keybinds';
import { hotkeyOf } from '../editor/keys';

/**
 * **Giữ Alt ⇒ hiện phím tắt** (người dùng 2026-10-13): mọi nút có phím tắt mà chưa ghi phím trên mặt nút hiện thêm một ô
 * vuông nhỏ ở góc với phím tắt bên trong; nhả Alt (hoặc rời cửa sổ) thì ẩn.
 *
 * Phím tắt lấy từ:
 *  - chú thích (`title`) của nút kết thúc bằng `(phím)` — vd. "Thu gọn bảng chọn máy  (F1)", "Hoàn tác (Ctrl+Z)";
 *  - vài nút gắn tay (`FIXED`): Thư viện công thức (L), Checklist dây chuyền (Ctrl).
 * Mọi phím lấy từ bảng phím hiện tại (`keybinds.ts`) — đổi phím trong Cài đặt thì ô phím đổi theo; phím "giữ để hiện"
 * cũng đổi được (mặc định Alt). Nút đã có nhãn phím riêng (`.dock-key` của cột công cụ) thì bỏ qua. Nút gắn
 * `data-kbd-pos="below"` (Làm lại) ⇒ ô phím nằm **dưới** nút để không đè lên ô phím của nút bên cạnh.
 */
const FIXED: [string, string][] = [
  ['.tb-recipes, .recipes-btn', 'recipes'],
  ['.cl-fab, .cl-hide', 'checklist'],
];

/** Ô phím của nút này nằm dưới nút (người dùng 2026-10-13: Làm lại — Ctrl+Shift+Z — đè lên ô của nút bên cạnh). */
export function kbdBelow<T extends HTMLElement>(b: T): T {
  b.dataset.kbdPos = 'below';
  return b;
}
/** `(Ctrl+Z)`, `(F1)`, `(Tab)`, `(Ctrl+Shift+Z)`… ở **cuối** chú thích. */
const KEY_RE = /\(((?:(?:Ctrl|Shift|Alt)\+)*(?:F\d{1,2}|Tab|Esc|Space|Del|Enter|[A-Z0-9]))\)\s*$/;

export function mountShortcutBadges(): void {
  const root = document.documentElement;
  let on = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const mark = (e: HTMLElement, key: string): void => {
    e.dataset.kbd = key;
    // ô phím neo theo chính nút: nút đang ở vị trí mặc định thì cho thành `relative` (nút cố định / tuyệt đối giữ nguyên)
    if (getComputedStyle(e).position === 'static') e.classList.add('kbd-rel');
  };
  const FIXED_SEL = FIXED.map(([sel]) => sel).join(', ');
  const tag = (): void => {
    for (const [sel, id] of FIXED) {
      const key = keyLabel(id);
      for (const e of document.querySelectorAll<HTMLElement>(sel)) if (key) mark(e, key);
    }
    for (const e of document.querySelectorAll<HTMLElement>('button[title], [role="button"][title]')) {
      if (e.querySelector('.dock-key')) continue;
      const m = KEY_RE.exec(e.title);
      if (m) mark(e, m[1]!);
      else if (e.dataset.kbd && !e.matches(FIXED_SEL)) delete e.dataset.kbd; // phím đã bỏ gán
    }
  };
  const show = (): void => {
    if (on) return;
    on = true;
    tag();
    root.classList.add('show-kbd');
    // giao diện vẽ lại trong lúc giữ ⇒ gắn lại nhãn
    timer = setInterval(tag, 300);
  };
  const hide = (): void => {
    if (!on) return;
    on = false;
    root.classList.remove('show-kbd');
    if (timer) clearInterval(timer);
    timer = null;
  };
  window.addEventListener('keydown', (e) => {
    const key = hotkeyOf(e);
    const mine = matchesKey('showKeys', key);
    if (mine && !e.repeat && (key === 'alt' || !(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]'))) {
      // Alt một mình: không để trình duyệt / Windows nhảy vào thanh menu
      if (key === 'alt' && !e.ctrlKey && !e.metaKey) e.preventDefault();
      show();
    } else if (on && !mine) hide();
  }, true);
  window.addEventListener('keyup', (e) => {
    const key = hotkeyOf(e);
    if (matchesKey('showKeys', key)) {
      if (key === 'alt') e.preventDefault();
      hide();
    }
  }, true);
  window.addEventListener('blur', hide);
}
