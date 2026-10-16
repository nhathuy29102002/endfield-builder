import { el } from './dom';

/**
 * Cảnh báo nổi giữa phía trên bản vẽ, tự tắt sau vài giây. Dùng cho lỗi người dùng cần
 * thấy ngay (vd. đặt bản vẽ vào chỗ vướng) — thanh trạng thái dưới đáy dễ bị bỏ qua.
 */
let host: HTMLElement | null = null;

/** `ms`: thời gian hiện (mặc định 2,6 s; lời nhắn dài / quan trọng — lỗi lưu, mở hai cửa sổ — để lâu hơn). */
export function toast(text: string, kind: 'warn' | 'info' = 'warn', ms = 2600): void {
  if (typeof document === 'undefined') return;
  host ??= document.body.appendChild(el('div', { class: 'toast-host' }));
  const node = el('div', { class: `toast ${kind}` }, text);
  host.append(node);
  setTimeout(() => node.classList.add('out'), ms);
  setTimeout(() => node.remove(), ms + 400);
}
