/**
 * **Đo hiệu năng khi chạy thật** (2026-10-13, công cụ cho dev — profiling map lớn). Mặc định **tắt**: chỉ bật khi đặt
 * `localStorage['efp:perf'] = '1'` rồi tải lại trang. Khi bật, mỗi lần giải (`solve`) và mỗi khung hình vẽ bản đồ
 * (`Renderer.draw`) được đo; cứ 5 giây in một bảng tóm tắt (số lần, trung bình, lớn nhất, p95) ra console và giữ bản mới
 * nhất ở `window.__efpPerf`. Tắt ⇒ `timed()` chỉ gọi thẳng hàm (không đo, không cấp phát).
 */
let on = false;
try {
  on = typeof localStorage !== 'undefined' && localStorage.getItem('efp:perf') === '1';
} catch {
  on = false;
}
export const perfEnabled = (): boolean => on;

const samples = new Map<string, number[]>();
let timer: ReturnType<typeof setInterval> | null = null;
const report = (): void => {
  const rows: Record<string, { n: number; avg: number; max: number; p95: number }> = {};
  for (const [k, v] of samples) {
    if (!v.length) continue;
    const s = [...v].sort((a, b) => a - b);
    rows[k] = { n: v.length, avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), max: +s[s.length - 1]!.toFixed(2), p95: +s[Math.floor(s.length * 0.95)]!.toFixed(2) };
    v.length = 0;
  }
  if (!Object.keys(rows).length) return;
  (globalThis as unknown as { __efpPerf: unknown }).__efpPerf = rows;
  console.table(rows);
};

/** Chạy `fn`, đo thời gian dưới nhãn `label` (chỉ khi đang bật đo). */
export function timed<T>(label: string, fn: () => T): T {
  if (!on) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const list = samples.get(label) ?? [];
    list.push(performance.now() - t0);
    samples.set(label, list);
    timer ??= setInterval(report, 5000);
  }
}
