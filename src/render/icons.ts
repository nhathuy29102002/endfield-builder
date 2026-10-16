import { dominantColor } from './dominant';
import type { Dataset } from '../model/types';

/**
 * Máy có hình **2D** nhìn từ trên xuống (`public/img/sprites2d/*.png`) — **cắt đúng từ ảnh chụp trong game** của người
 * dùng, nền trong suốt (`tools/make-sprites2d.py`, 2026-10-06; thay hình của trang tham khảo). Ảnh rộng hơn đế (vòng nắp / van thò
 * ra ngoài ô như trong game) ⇒ vẽ to hơn đế `SPRITE_2D_SCALE` lần, canh giữa ô.
 * Van/cầu 1×1 chỉ có ảnh biểu tượng trong `img/sprites/` — vẽ lên lưới trông như cái
 * nút bấm chứ không ra hình băng/ống đi qua; hình 2D này mới đúng kiểu nhìn từ trên
 * xuống. Hình ở hướng 0 đã khớp cổng của ta (van tách vào từ dưới, van gộp ra phía trên).
 */
export const SPRITE_2D_SCALE = 240 / 195;
const SPRITES_2D = new Set([
  'log_converger',
  'log_splitter',
  'log_conditioner',
  'log_connector',
  'log_pipe_converger',
  'log_pipe_splitter',
  'log_pipe_conditioner',
  'log_pipe_connector',
]);

/**
 * Kho ảnh biểu tượng, nạp theo nhu cầu.
 *
 * Canvas không vẽ được `<img>` chưa tải xong, nên ảnh nào chưa có thì bỏ qua và gọi
 * `onLoad` khi tải xong để vẽ lại — không chặn khung hình nào.
 */
const VALVE_ICONS: Record<string, string> = {
  log_splitter: 'splitter',
  log_pipe_splitter: 'splitter',
  log_converger: 'converger',
  log_pipe_converger: 'converger',
  log_connector: 'bridge',
  log_pipe_connector: 'bridge',
  log_conditioner: 'port',
  log_pipe_conditioner: 'port',
};

export class IconCache {
  private images = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();

  constructor(private onLoad: () => void) {}

  private get(path: string): HTMLImageElement | undefined {
    if (this.failed.has(path)) return undefined;
    const have = this.images.get(path);
    if (have) return have.complete && have.naturalWidth > 0 ? have : undefined;

    const img = new Image();
    img.decoding = 'async';
    img.addEventListener('load', () => this.onLoad());
    img.addEventListener('error', () => {
      this.failed.add(path);
      this.images.delete(path);
    });
    img.src = path;
    this.images.set(path, img);
    return undefined;
  }

  /**
   * Icon **xem trước** của 4 loại van (Tách / Gộp / Cầu nối / Cảng kiểm soát, cả bản băng và bản ống) — người dùng
   * 2026-10-13, ảnh `public/img/valve/` lấy từ game. Chỉ dùng khi đang đặt / sao chép / di chuyển; đặt xuống rồi vẫn
   * vẽ hình 2D nhìn từ trên xuống như cũ.
   */
  valve(machineId: string): { img: HTMLImageElement; turn: number } | undefined {
    const name = VALVE_ICONS[machineId];
    if (!name) return undefined;
    const img = this.get(`img/valve/${name}.png`);
    // ảnh vẽ dòng chảy **từ trên xuống**; ở góc xoay 0 dòng chính của van chảy **lên** (`flowDir(180)` = −z) ⇒ +180°.
    // Cảng kiểm soát (kính lúp) không có hướng ⇒ giữ đứng
    return img ? { img, turn: name === 'port' ? -1 : 180 } : undefined;
  }

  item(ds: Dataset, itemId: string): HTMLImageElement | undefined {
    const icon = ds.items.get(itemId)?.icon ?? itemId;
    return this.get(`img/itemicon/${icon}.png`);
  }

  private colors = new Map<string, string | null>();
  /**
   * Màu chủ đạo của ảnh vật phẩm (`dominantColor`) — tính một lần khi ảnh đã tải, lưu lại. Ảnh chưa tải xong ⇒ `undefined`
   * (gọi lại sau); không đọc được điểm ảnh ⇒ `null`.
   */
  itemColor(ds: Dataset, itemId: string): string | null | undefined {
    const icon = ds.items.get(itemId)?.icon ?? itemId;
    const path = `img/itemicon/${icon}.png`;
    if (this.colors.has(path)) return this.colors.get(path);
    const img = this.get(path);
    if (!img) return undefined;
    let color: string | null = null;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (g) {
        g.drawImage(img, 0, 0, 32, 32);
        color = dominantColor(g.getImageData(0, 0, 32, 32).data);
      }
    } catch {
      color = null; // ảnh khác nguồn / không đọc được
    }
    this.colors.set(path, color);
    return color;
  }

  machine(ds: Dataset, machineId: string): HTMLImageElement | undefined {
    const icon = ds.machines.get(machineId)?.icon;
    return icon ? this.get(`img/items/${icon}.png`) : undefined;
  }

  /**
   * Sprite trải kín đế máy, nếu có.
   *
   * Đây mới là **hình dạng công trình thật** trên lưới; ảnh trong `img/items/` chỉ là
   * biểu tượng cho bảng chọn máy. Sprite thường cao hơn đế của nó (tháp, ống khói) nên
   * nơi vẽ phải giữ tỉ lệ và neo theo mép dưới, đừng kéo cho vừa khít ô.
   *
   * Thiếu file thì quay về vẽ khối kim loại + biểu tượng, nên bộ sprite không đầy đủ
   * vẫn dùng được.
   */
  /** Hình 2D khít đế (xem `SPRITES_2D`); `undefined` nếu máy không có. */
  sprite2d(machineId: string): HTMLImageElement | undefined {
    return SPRITES_2D.has(machineId) ? this.get(`img/sprites2d/${machineId}.png`) : undefined;
  }

  sprite(ds: Dataset, machineId: string): HTMLImageElement | undefined {
    const icon = ds.machines.get(machineId)?.icon;
    return icon ? this.get(`img/sprites/${icon}.png`) : undefined;
  }
}
