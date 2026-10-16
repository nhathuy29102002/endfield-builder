/**
 * **Ghi lỗi toàn cục** (2026-10-13, công cụ cho dev): lỗi JavaScript không ai bắt và promise bị từ chối mà không xử lý
 * được giữ lại 20 lỗi gần nhất trong `window.__efpErrors` (thời điểm + nội dung + chồng gọi) để tra khi người dùng báo
 * lỗi — mở DevTools / CDP rồi đọc biến đó. **Không** hiện gì lên giao diện, không đổi cách app chạy.
 */
export interface ErrorEntry {
  at: string;
  kind: 'error' | 'promise';
  message: string;
  stack?: string;
}
export function mountErrorLog(limit = 20): void {
  const log: ErrorEntry[] = [];
  (window as unknown as { __efpErrors: ErrorEntry[] }).__efpErrors = log;
  const push = (e: ErrorEntry): void => {
    log.push(e);
    if (log.length > limit) log.shift();
  };
  // chỉ lỗi chạy mã (lỗi tải ảnh / file không nổi lên `window` khi không bắt ở pha capture)
  window.addEventListener('error', (e) => {
    push({ at: new Date().toISOString(), kind: 'error', message: e.message || String(e.error), stack: (e.error as Error | undefined)?.stack });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown;
    push({ at: new Date().toISOString(), kind: 'promise', message: r instanceof Error ? r.message : String(r), stack: r instanceof Error ? r.stack : undefined });
    // trình duyệt vẫn tự in ra console như thường — không chặn
  });
}
