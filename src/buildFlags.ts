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
 * **Góp ý** (người dùng 2026-10-17): nút hình bức thư cạnh "Tải app" trong Cài đặt mở **biểu mẫu Google** của chủ app —
 * người gửi không cần tài khoản, không thấy email của chủ app. App **tự điền sẵn** phiên bản và thiết bị đang dùng
 * (`FEEDBACK_FIELDS` = mã câu hỏi trong biểu mẫu; đổi câu hỏi trên Google thì mã đổi ⇒ lấy lại ở "Lấy đường liên kết được
 * điền sẵn"). `FEEDBACK_EMAIL` khác rỗng ⇒ nút mở trình gửi thư tới địa chỉ đó thay cho biểu mẫu.
 */
export const FEEDBACK_EMAIL = '';
export const FEEDBACK_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSd6E6U6hNOdnaWw10vWLNYdLZlVUiLBJ5gyoQvaDevSgICeAA/viewform';
export const FEEDBACK_FIELDS = {
  /** "Bạn hiện đang dùng phiên bản nào ?" — trả lời ngắn */
  version: 'entry.1020243085',
  /** "Thiết bị sử dụng" — ô tích: `Web - Android` · `Web - PC` · `PC` · `Android` */
  device: 'entry.1004082783',
};
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
export const DOWNLOAD = {
  /** Bộ cài Windows (NSIS). */
  windows: `https://github.com/${REPO}/releases/latest/download/EndfieldAICPlanner-setup.exe`,
  /** App Android (APK đã ký). */
  android: `https://github.com/${REPO}/releases/latest/download/EndfieldAICPlanner.apk`,
};
