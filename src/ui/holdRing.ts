/**
 * **Vòng đếm giữ** (người dùng 2026-10-11): giữ chuột trái / ngón tay trên một máy (hoặc nhóm đang chọn) ⇒ một vòng tròn
 * hiện **ngay tại điểm ấn**, đầy dần **theo chiều kim đồng hồ** trong `HOLD_LIFT_MS` (0,5 s — người dùng 2026-10-11, lần 2;
 * lúc đầu 0,75 s), màu trắng; đầy thì máy / nhóm được nhấc lên.
 * Rê ra ngoài vòng hoặc nhấc tay trước khi đầy ⇒ huỷ. Vòng rộng **2 cm trên điện thoại** (người dùng 2026-10-12: gấp đôi
 * 1 cm cũ), nhỏ hơn trên máy tính.
 */
export const HOLD_LIFT_MS = 500;
/** Ngón tay (điện thoại) nhanh hơn chuột 0,1 s: 0,4 s (người dùng 2026-10-13 — đo thực tế trước đó ~0,55 s). */
export const HOLD_LIFT_TOUCH_MS = 400;
const liftMs = (touch: boolean): number => (touch ? HOLD_LIFT_TOUCH_MS : HOLD_LIFT_MS);

/** Bán kính vòng (px CSS): điện thoại đường kính 2 cm (96 px CSS = 1 inch = 2,54 cm), máy tính 24 px. */
export const holdRingRadius = (touch: boolean): number => (touch ? 96 / 2.54 : 12);

export interface HoldRing {
  /** Điểm ấn còn trong vòng không (toạ độ màn hình). */
  inside(x: number, y: number): boolean;
  /** Bỏ vòng (huỷ hoặc đã đầy). */
  remove(): void;
}

/** Vẽ vòng tại `(x, y)` (toạ độ màn hình) và gọi `onFull` khi vòng đầy. */
export function showHoldRing(x: number, y: number, touch: boolean, onFull: () => void): HoldRing {
  const r = holdRingRadius(touch);
  const size = Math.round(r * 2 + 8);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', `hold-ring${touch ? ' touch' : ''}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.style.left = `${x - size / 2}px`;
  svg.style.top = `${y - size / 2}px`;
  const c = size / 2;
  const ring = r - 2;
  const len = 2 * Math.PI * ring;
  const track = document.createElementNS(ns, 'circle');
  track.setAttribute('class', 'hold-ring-track');
  const fill = document.createElementNS(ns, 'circle');
  fill.setAttribute('class', 'hold-ring-fill');
  for (const k of [track, fill]) {
    k.setAttribute('cx', String(c));
    k.setAttribute('cy', String(c));
    k.setAttribute('r', String(ring));
  }
  // bắt đầu ở đỉnh vòng (12 giờ), đầy theo chiều kim đồng hồ
  fill.setAttribute('transform', `rotate(-90 ${c} ${c})`);
  fill.style.strokeDasharray = `${len}`;
  fill.style.strokeDashoffset = `${len}`;
  svg.append(track, fill);
  document.body.append(svg);
  fill.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: liftMs(touch), easing: 'linear', fill: 'forwards' });
  let gone = false;
  const timer = setTimeout(() => {
    if (gone) return;
    api.remove();
    onFull();
  }, liftMs(touch));
  const api: HoldRing = {
    inside: (px, py) => Math.hypot(px - x, py - y) <= r,
    remove: () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      svg.remove();
    },
  };
  return api;
}
