/**
 * Cờ của bản build.
 *
 * `PUBLIC_BUILD` — **bản public** (GitHub / web công khai, người dùng 2026-10-06): `npm run build:public` (= `vite build
 * --mode public`, đọc `.env.public` ⇒ `VITE_PUBLIC=1`). Bản này **tạm bỏ tính năng nhập bản vẽ của trang tham khảo** (mã game
 * `EFO0…` tra qua API của trang tham khảo + chuỗi bản vẽ trang tham khảo) — ô "Nhập mã bản vẽ" trong cửa sổ Bản vẽ không hiện. Bản build
 * thường (`npm run build`, exe, apk build trên máy) giữ nguyên; exe / apk do GitHub Actions build là bản public.
 */
export const PUBLIC_BUILD: boolean = import.meta.env.VITE_PUBLIC === '1';

/** Số phiên bản (từ `package.json`, `vite.config.ts` → `define`); GitHub Actions đặt theo tag `vX.Y.Z`. */
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/**
 * Kho GitHub công khai (người dùng 2026-10-06). Bản phát hành do GitHub Actions build (`.github/workflows/release.yml`)
 * đặt tên file cố định ⇒ link `releases/latest/download/<file>` luôn trỏ bản mới nhất.
 */
export const REPO = 'nhathuy29102002/endfield-builder';
/**
 * **Góp ý** (người dùng 2026-10-16): nút hình bức thư cạnh "Tải app" trong Cài đặt mở **biểu mẫu góp ý** trên GitHub
 * (`.github/ISSUE_TEMPLATE/feedback.yml` — người gửi không cần biết email của chủ repo). `FEEDBACK_EMAIL` khác rỗng ⇒
 * nút mở trình gửi thư tới địa chỉ đó thay cho biểu mẫu (địa chỉ sẽ hiện công khai).
 */
export const FEEDBACK_EMAIL = '';
export const FEEDBACK_FORM = `https://github.com/${REPO}/issues/new?template=feedback.yml`;
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
export const DOWNLOAD = {
  /** Bộ cài Windows (NSIS). */
  windows: `https://github.com/${REPO}/releases/latest/download/EndfieldAICPlanner-setup.exe`,
  /** App Android (APK đã ký). */
  android: `https://github.com/${REPO}/releases/latest/download/EndfieldAICPlanner.apk`,
};
