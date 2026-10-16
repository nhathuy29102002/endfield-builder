import type { AppState } from '../editor/state';
import { matches } from '../keybinds';
import { LIBRARY_GOTO_EVENT, openRecipeLibrary, type LibraryTarget } from './recipeLibrary';

/**
 * **Chuột giữa lên icon** (người dùng 2026-10-13; nút đổi được trong Cài đặt → Phím tắt): bấm chuột giữa lên bất kỳ icon vật phẩm nào (bảng chọn, cửa sổ máy,
 * Modeler, Checklist, thư viện…) ⇒ mở ngay trang thư viện của vật phẩm đó; icon **môi trường** ⇒ trang môi trường (các
 * công thức chạy trong môi trường đó). Icon Empty / icon máy thì bỏ qua.
 *
 * Vật phẩm nhận ra từ **đường dẫn ảnh** của icon (không phải chỗ nào cũng gắn mã vật phẩm vào phần tử):
 *  - `img/itemicon/filled/<id>.png` (bình / lọ đã nạp) ⇒ đúng mã;
 *  - `img/itemicon/<icon>.png` ⇒ tra ngược tên icon → vật phẩm (ưu tiên vật phẩm có mã trùng tên icon);
 *  - `img/env/<môi trường>(-glyph).png` ⇒ môi trường.
 */
export function mountItemLinks(state: AppState): void {
  const byIcon = new Map<string, string>();
  for (const it of state.ds.items.values()) {
    const icon = it.icon ?? it.id;
    if (!byIcon.has(icon) || icon === it.id) byIcon.set(icon, it.id);
  }
  const ENVS: Record<string, string> = { stable: 'Stable', acid: 'Acid', humidity: 'Humidity', xiranite: 'Xiranite' };
  const targetOf = (src: string): LibraryTarget | null => {
    const path = src.replace(/^.*?img\//, 'img/').split('?')[0]!;
    let m = /^img\/env\/([a-z]+)(?:-glyph)?\.png$/.exec(path);
    if (m) return ENVS[m[1]!] ? { env: ENVS[m[1]!]! } : null;
    m = /^img\/itemicon\/filled\/(.+)\.png$/.exec(path);
    if (m) return state.ds.items.has(decodeURIComponent(m[1]!)) ? { item: decodeURIComponent(m[1]!) } : null;
    m = /^img\/itemicon\/(.+)\.png$/.exec(path);
    if (m) {
      const id = byIcon.get(decodeURIComponent(m[1]!));
      return id ? { item: id } : null;
    }
    return null;
  };
  /** Icon dưới con trỏ: chính ảnh, hoặc ảnh duy nhất trong ô / nút được bấm. */
  const iconAt = (t: EventTarget | null): HTMLImageElement | null => {
    const e = t as Element | null;
    if (!e?.closest) return null;
    if (e instanceof HTMLImageElement) return e;
    const box = e.closest('button, .cl-tile, .rl-tile, .md-port, .sim-slot, .mp-io-cell, span, div');
    const imgs = box ? box.querySelectorAll('img') : [];
    return imgs.length === 1 ? (imgs[0] as HTMLImageElement) : null;
  };
  const open = (t: LibraryTarget): void => {
    if (document.querySelector('.rl-overlay')) window.dispatchEvent(new CustomEvent(LIBRARY_GOTO_EVENT, { detail: t }));
    else openRecipeLibrary(state, t);
  };
  // nút bấm đổi được (`keybinds.ts` `itemLib`, mặc định chuột giữa; gán được chuột trái / phải kèm Ctrl / Shift / Alt)
  /** Chỗ nhấn — kéo (cuộn khung nhìn Modeler / bản đồ) quá 5 px thì không tính là bấm. */
  let down: { x: number; y: number } | null = null;
  window.addEventListener('mousedown', (e) => {
    if (!matches('itemLib', e)) return;
    down = { x: e.clientX, y: e.clientY };
    const img = iconAt(e.target);
    // chặn cuộn tự động của chuột giữa / việc khác của nút khi nhấn lên icon vật phẩm
    if (img && targetOf(img.getAttribute('src') ?? '')) {
      e.preventDefault();
      if (e.button !== 1) e.stopPropagation();
    }
  }, true);
  const onClick = (e: MouseEvent): void => {
    if (!matches('itemLib', e)) return;
    const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
    down = null;
    if (moved > 5) return;
    const img = iconAt(e.target);
    const t = img ? targetOf(img.getAttribute('src') ?? '') : null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    open(t);
  };
  // chuột trái ⇒ `click`; chuột giữa / phải ⇒ `auxclick`
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
  // chuột phải: không hiện menu của trình duyệt khi bấm lên icon
  window.addEventListener('contextmenu', (e) => {
    if (!matches('itemLib', e)) return;
    const img = iconAt(e.target);
    if (img && targetOf(img.getAttribute('src') ?? '')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}
