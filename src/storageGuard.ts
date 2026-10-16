import { tr } from './i18n';

/**
 * **Bảo vệ dữ liệu lưu trên máy** (rà soát 2026-10-14) — mọi map, tab, thư viện chỉ nằm trong trình duyệt / app:
 *  - `reportStorageError`: ghi `localStorage` lỗi (hết chỗ, bị chặn) ⇒ báo người dùng bằng toast (trước đây nuốt lỗi,
 *    người dùng tưởng đã lưu). Gộp: tối đa một lần mỗi 30 s.
 *  - `requestPersistentStorage`: xin trình duyệt **giữ dữ liệu lâu dài** (`navigator.storage.persist()`) — không xin thì
 *    trình duyệt được tự dọn khi thiếu chỗ; Safari còn xoá dữ liệu của trang không mở trong 7 ngày.
 *  - `watchOtherWindows`: app đang mở ở **cửa sổ / tab trình duyệt khác** ⇒ báo (các tab bản vẽ lưu chung một chỗ,
 *    cửa sổ lưu sau ghi đè cửa sổ kia).
 */
export const STORAGE_ERROR_EVENT = 'efp:storage-error';

let lastReport = 0;
export function reportStorageError(what: string, err: unknown): void {
  console.warn(`[storage] không lưu được ${what}:`, err);
  const now = Date.now();
  if (now - lastReport < 30_000) return;
  lastReport = now;
  const full =
    err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22);
  const text = full
    ? tr('Bộ nhớ trình duyệt đã đầy — {0} chưa được lưu. Hãy xuất bản vẽ ra file, hoặc đóng / xoá bớt tab và bản vẽ cũ.', what)
    : tr('Không lưu được {0} vào bộ nhớ trình duyệt — tải lại trang có thể mất các thay đổi gần đây.', what);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: text }));
}

/** Một lần mỗi phiên: xin giữ dữ liệu lâu dài (Chrome tự quyết theo mức dùng trang; Firefox có thể hỏi người dùng). */
let asked = false;
export function requestPersistentStorage(): void {
  if (asked) return;
  asked = true;
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.persist || !s.persisted) return;
  void s
    .persisted()
    .then((yes) => (yes ? true : s.persist()))
    .then((ok) => {
      if (!ok) console.info('[storage] trình duyệt chưa cho giữ dữ liệu lâu dài (có thể bị dọn khi thiếu chỗ)');
    })
    .catch(() => undefined);
}

/** Báo một lần khi phát hiện app đang mở ở cửa sổ / tab trình duyệt khác (cả hai phía đều được báo). */
export function watchOtherWindows(onOther: () => void): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const id = Math.random().toString(36).slice(2);
  const ch = new BroadcastChannel('efp-windows');
  let warned = false;
  const warn = (): void => {
    if (warned) return;
    warned = true;
    onOther();
  };
  ch.onmessage = (e: MessageEvent) => {
    const m = e.data as { t?: string; id?: string } | null;
    if (!m || m.id === id) return;
    if (m.t === 'hello') {
      ch.postMessage({ t: 'here', id });
      warn();
    } else if (m.t === 'here') warn();
  };
  ch.postMessage({ t: 'hello', id });
}
