import { keyLabel, matches } from '../keybinds';
import type { AppState } from '../editor/state';
import type { Renderer } from '../render/renderer';
import { machineAt } from '../editor/ops';
import { enterTool } from '../editor/tools';
import { roleOf } from '../model/roles';
import { MODELER_FOCUS_EVENT } from '../modeler/doc';
import { pinnedMachineIds } from './palette';
import { el } from './dom';
import { tr } from '../i18n';

/**
 * **Hướng dẫn sử dụng** (người dùng 2026-10-12, theo 13 ảnh `Tutorial/`). Mỗi **chương** tự bật khi người dùng làm tới đúng
 * chỗ đó (điều kiện kích hoạt) và chỉ hiện một lần:
 *   1. Làm quen (mở app ở Map) → 2. Chọn máy (chọn một máy) → 3. Mô phỏng (vào chế độ mô phỏng) → 4. Thư viện (mở Thư viện
 *   công thức) → 5. Hồ sơ vật phẩm → 6. Chuỗi sản xuất → 7. Modeler (mở sơ đồ Modeler có máy).
 * Cửa sổ: phủ tối gần như toàn màn hình, **khoét sáng** các đối tượng cần chú ý (viền vàng nhấp nháy; đổi đối tượng thì ô
 * sáng **trượt / nở** sang chỗ mới), thẻ chữ đặt về phía còn trống, **hoạt ảnh bàn tay** chạm / kéo; X để tắt, ‹ › để xem
 * bước trước / sau. Điện thoại: vuốt thẻ trái / phải.
 * Vùng sáng luôn **bấm / chạm xuyên** được (người dùng 2026-10-12, lần 3) — cả cử chỉ bắt đầu trong vùng sáng (kéo máy ra bản
 * đồ, cuộn danh sách…) đi qua; ngoài vùng sáng bị chặn. Hai loại bước:
 *  - **xem** (`view`): thao tác trong vùng sáng **không** đổi bước; chạm thẻ / chỗ tối để sang bước sau;
 *  - **làm thử** (`do`): làm đúng thao tác (`done`) thì tự sang bước sau.
 * Bước có **nhánh** (`branch`): người dùng làm theo (vd. chọn máy được chỉ) ⇒ hiện bước phụ; sang bước thì bước phụ dọn dẹp
 * (`leave`, vd. thu gọn cửa sổ máy) rồi về nhánh chính. Dòng gợi ý dưới thẻ chỉ nói **làm gì thì được gì** (không còn "chạm
 * để tiếp").
 * Cài đặt có dòng bật / tắt và nút "Xem lại từ đầu" (`tutorialSettingsRow`). Lưu ở `efp:tutorial`.
 */
type Anim = 'tap' | 'drag' | undefined;
type Target = Element | DOMRect | null;
interface Step {
  /** Đối tượng cần khoét sáng (bỏ qua cái không thấy trên màn hình). */
  targets: () => Target[];
  text: () => string;
  /** Gợi ý thao tác ngắn ("Chọn máy bất kì để xem chi tiết"). */
  hint?: () => string;
  /** Hoạt ảnh bàn tay: chạm vào `handAt`, hoặc kéo từ đó ra giữa bản đồ. */
  anim?: Anim | (() => Anim);
  /** Chỗ bàn tay chạm / kéo từ đó — mặc định đối tượng đầu tiên. */
  handAt?: () => Target;
  /** `view` (mặc định): chạm thẻ / chỗ tối để sang bước; `do`: làm xong (`done`) thì tự sang bước. */
  kind?: 'view' | 'do';
  done?: () => boolean;
  /** Chạy khi vào bước (mở sẵn bảng cần thiết…). */
  prepare?: () => void;
  /** Chạy khi rời bước (gỡ trạng thái tạm). */
  leave?: () => void;
  /** Mỗi nhịp (300 ms) khi đang ở bước. */
  tick?: () => void;
  /** Người dùng vừa bấm / chạm xuyên vùng sáng (`e` = pointerdown). */
  onPass?: (e: Event) => void;
  /** Vùng không khoét sáng nhưng thẻ chữ phải tránh (bảng chú thích Modeler). */
  avoid?: () => DOMRect[];
  /** Gộp các ô sáng liền nhau (danh sách máy). */
  merge?: boolean;
  /** Nhánh phụ: điều kiện xảy ra trong lúc ở bước này ⇒ hiện bước phụ. */
  branch?: { when: () => boolean; step: Step };
}
interface Chapter {
  id: string;
  title: string;
  when: () => boolean;
  steps: Step[];
}

const KEY = 'efp:tutorial';
type Saved = { off: boolean; seen: string[] };
const load = (): Saved => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return { off: v.off === true, seen: Array.isArray(v.seen) ? v.seen : [] };
  } catch {
    return { off: false, seen: [] };
  }
};
let saved = load();
const save = (): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* không lưu được thì thôi */
  }
};

const touch = (): boolean => document.documentElement.classList.contains('touch-ui');
const shown = (e: Element): boolean => {
  const r = e.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(e).visibility !== 'hidden';
};
/** Phần tử đầu tiên khớp `sel` đang **hiện** trên màn hình (có kích thước, không bị ẩn). */
const vis = (sel: string): HTMLElement | null => {
  for (const e of document.querySelectorAll<HTMLElement>(sel)) if (shown(e)) return e;
  return null;
};
const has = (sel: string): boolean => !!vis(sel);
/** Khung bao của nhiều phần tử. */
const union = (es: Element[]): DOMRect | null => {
  const rs = es.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  if (!rs.length) return null;
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  return new DOMRect(l, t, Math.max(...rs.map((r) => r.right)) - l, Math.max(...rs.map((r) => r.bottom)) - t);
};
const clip = (r: DOMRect, c: DOMRect): DOMRect | null => {
  const l = Math.max(r.left, c.left);
  const t = Math.max(r.top, c.top);
  const w = Math.min(r.right, c.right) - l;
  const h = Math.min(r.bottom, c.bottom) - t;
  return w > 4 && h > 4 ? new DOMRect(l, t, w, h) : null;
};
/** Gộp các ô liền nhau cùng cột (cùng trái / phải) hoặc cùng hàng (cùng trên / dưới). */
const mergeRects = (rs: DOMRect[]): DOMRect[] => {
  const out = rs.map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom }));
  for (let again = true; again; ) {
    again = false;
    outer: for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        // cùng cột: chồng nhau theo chiều ngang ≥ 80 % bề rộng ô hẹp hơn (tiêu đề nhóm hơi khác bề rộng dòng máy)
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const col = ox >= 0.8 * Math.min(a.r - a.l, b.r - b.l) && b.t - a.b < 14 && a.t - b.b < 14;
        const row = Math.abs(a.t - b.t) < 3 && Math.abs(a.b - b.b) < 3 && b.l - a.r < 14 && a.l - b.r < 14;
        if (!col && !row) continue;
        out[i] = { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
        out.splice(j, 1);
        again = true;
        break outer;
      }
  }
  return out.map((o) => new DOMRect(o.l, o.t, o.r - o.l, o.b - o.t));
};

let api: { reset(): void } | null = null;

export function mountTutorial(app: HTMLElement, state: AppState, renderer: Renderer): void {
  const canvas = (): HTMLCanvasElement | null => document.querySelector('canvas.board');
  /** Khung màn hình của một máy (quét thưa các điểm trên canvas — đúng cả khi camera xoay). */
  /**
   * Nhớ kết quả `machineRect` (2026-10-13 — ô sáng trượt bị giật): mỗi lần quét ~10 000 điểm × `machineAt`, mà lúc ô
   * sáng đang trượt thì đo lại **mỗi khung hình**. Kết quả chỉ đổi khi camera, khung canvas hoặc vị trí / hướng máy đổi
   * ⇒ giữ theo "chữ ký" của những thứ đó; đổi gì thì quét lại như cũ.
   */
  const rectMemo = new Map<string, DOMRect | null>();
  let memoSig = '';
  const sceneSig = (r: DOMRect): string => {
    const cam = renderer.camera;
    let h = state.bp.machines.length;
    for (const m of state.bp.machines) h = (Math.imul(h, 31) + m.uid * 7 + m.x * 131 + m.z * 17 + m.rot) | 0;
    return `${cam.x},${cam.z},${cam.cell},${cam.turns},${cam.spin},${r.left},${r.top},${r.width},${r.height},${h}`;
  };
  const machineRect = (pick: (uid: number) => boolean, tag?: string): DOMRect | null => {
    const c = canvas();
    if (!c) return null;
    if (tag) {
      const sig = sceneSig(c.getBoundingClientRect());
      if (sig !== memoSig) {
        rectMemo.clear();
        memoSig = sig;
      }
      if (rectMemo.has(tag)) return rectMemo.get(tag)!;
      const res = machineRect(pick);
      rectMemo.set(tag, res);
      return res;
    }
    const r = c.getBoundingClientRect();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let y = 6; y < r.height; y += 10)
      for (let x = 6; x < r.width; x += 10) {
        const m = machineAt(state.bp, state.ds, renderer.camera.toCell(x, y));
        if (!m || !pick(m.uid)) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    return x1 < x0 ? null : new DOMRect(r.left + x0 - 6, r.top + y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
  };
  /** Phần bản đồ đang thấy, trừ bảng chọn máy (trái) và bảng Tổng hợp (phải). */
  const cameraRect = (): DOMRect | null => {
    const c = canvas()?.getBoundingClientRect();
    if (!c) return null;
    const pal = vis('.panel.left')?.getBoundingClientRect();
    const sum = summaryOpen() ? vis('.panel.right')?.getBoundingClientRect() : undefined;
    const l = Math.max(c.left, pal && pal.left < c.left + c.width / 2 ? pal.right : c.left);
    const r = Math.min(c.right, sum && sum.left > c.left + c.width / 2 ? sum.left : c.right);
    const b = Math.min(c.bottom, innerHeight);
    return r - l > 20 ? new DOMRect(l + 4, c.top + 4, r - l - 8, b - c.top - 8) : null;
  };
  /**
   * **Máy sản xuất** (công thức — không cột điện, kho hàng…) ngẫu nhiên trong phần bản đồ đang thấy để mời người dùng chọn
   * thử (người dùng 2026-10-12, lần 3). Nhớ theo `key` để ô sáng không nhảy lung tung.
   */
  const demo = new Map<string, number>();
  const demoMachine = (key: string): DOMRect | null => {
    const known = demo.get(key);
    if (known !== undefined && state.bp.machines.some((m) => m.uid === known)) {
      const r = machineRect((u) => u === known, `u:${known}`);
      if (r) return r;
    }
    const c = canvas();
    const cam = cameraRect();
    if (!c || !cam) return null;
    const r = c.getBoundingClientRect();
    const found: number[] = [];
    for (let k = 0; k < 700 && found.length < 12; k++) {
      // xoắn ốc từ tâm phần bản đồ đang thấy ra ngoài
      const x = cam.left - r.left + cam.width / 2 + Math.cos(k * 0.5) * k * 3;
      const y = cam.top - r.top + cam.height / 2 + Math.sin(k * 0.5) * k * 3;
      if (x < cam.left - r.left || y < cam.top - r.top || x > cam.right - r.left || y > cam.bottom - r.top) continue;
      const m = machineAt(state.bp, state.ds, renderer.camera.toCell(x, y));
      if (!m || m.fixed || found.includes(m.uid)) continue;
      const def = state.ds.machines.get(m.machineId);
      if (def && roleOf(def) === 'crafter') found.push(m.uid);
    }
    if (!found.length) return null;
    const uid = found[Math.floor(Math.random() * found.length)]!;
    demo.set(key, uid);
    return machineRect((u) => u === uid, `u:${uid}`);
  };
  const selectedRect = (): DOMRect | null => {
    const sel = state.selection;
    return machineRect((u) => (sel !== null ? u === sel : state.sel.machines.has(u)), `sel:${sel ?? [...state.sel.machines].join(',')}`);
  };
  const summaryOpen = (): boolean => !app.classList.contains('right-collapsed');
  const mwOpen = (): boolean => has('.machine-window:not(.collapsed)');
  const collapseMw = (): void => {
    if (mwOpen()) document.querySelector<HTMLElement>('.machine-window .mw-collapse')?.click();
  };
  const paletteOpen = (): boolean => !app.classList.contains('palette-collapsed') && !app.classList.contains('palette-hidden');
  /** Mở sẵn bảng chọn máy (đang thu gọn / giấu thì các bước sau không thấy gì — lỗi khi "Xem lại từ đầu"). */
  const openPalette = (): void => {
    if (app.classList.contains('palette-hidden')) document.querySelector<HTMLElement>('.palette-peek')?.click();
    if (app.classList.contains('palette-collapsed')) window.dispatchEvent(new Event('efp:toggle-palette'));
  };
  const holding = (): boolean => state.tool.kind === 'place' || state.tool.kind === 'group' || state.tool.kind === 'stamp';
  const dialogOpen = (): boolean => !!document.querySelector('.bp-overlay, .md-dialog, .ip-panel');
  const undoLen = (): number => state.exportDoc().undo.length;
  /** Các dòng máy **chưa ghim** đang thấy trong bảng chọn máy (bước ghim: giữ sẵn trạng thái rê chuột ⇒ thấy nút ghim). */
  const unpinnedRows = (): HTMLElement[] => {
    const pal = vis('.panel.left .palette-list') ?? vis('.panel.left');
    const box = pal?.getBoundingClientRect();
    if (!box) return [];
    return [...document.querySelectorAll<HTMLElement>('.panel.left button.machine')].filter((b) => {
      if (b.querySelector('.pin.on')) return false;
      const r = b.getBoundingClientRect();
      return r.height > 2 && r.bottom > box.top + 4 && r.top < box.bottom - 4;
    });
  };
  const clearHover = (): void => document.querySelectorAll('.tut-hover').forEach((e) => e.classList.remove('tut-hover'));
  const handle = (): HTMLElement | null => vis('.dock .drawer-handle');

  // ---- trạng thái riêng của từng bước
  let sumWas = false;
  let pins0 = 0;
  /** Bước "Chọn máy 2": người dùng bấm một nút thao tác ⇒ tạm tắt lớp phủ tới khi làm xong một lần. */
  let trial: { undo: number; uid: number | null; busySeen: boolean; at: number } | null = null;
  let simTouched = false;
  let simSel: number | null = null;
  let chainKeys: { node: string; mach: string } | null = null;
  let mdFocus: string | null = null;

  /** Đặt bước "ô khoanh theo nút" của chuỗi sản xuất: nút Công thức khác + một máy, khoá ổn định `data-k`. */
  const chainTargets = (): { holes: Target[]; pick: HTMLElement | null } => {
    if (!chainKeys || !document.querySelector(`.rl-world [data-k="${CSS.escape(chainKeys.node)}#pill"]`)) {
      const pill = vis('.rl-world .rl-more');
      const mach = vis('.rl-world .rl-mach');
      chainKeys = { node: pill?.dataset.k?.replace(/#pill$/, '') ?? '', mach: mach?.dataset.k ?? '' };
    }
    const q = (k: string): HTMLElement | null => (k ? document.querySelector<HTMLElement>(`.rl-world [data-k="${CSS.escape(k)}"]`) : null);
    const pill = q(`${chainKeys.node}#pill`);
    const mach = q(chainKeys.mach) ?? vis('.rl-world .rl-mach');
    if (pill?.classList.contains('up')) {
      // đang mở "Công thức khác": khoanh cả phần các cách làm khác (máy + nguyên liệu + nút Ẩn); bàn tay chỉ "Đặt công thức mặc định"
      const part = [...document.querySelectorAll<HTMLElement>(`.rl-world [data-k^="${CSS.escape(chainKeys.node)}#w:"]`)];
      // tính cả phần nổi trên đầu ô máy (ô "Công thức mặc định", dải môi trường) — nằm ngoài khung của ô máy
      const box = union([...part, ...part.flatMap((p) => [...p.querySelectorAll(':scope > .rl-mach-top')]), pill]);
      const pick = part.map((p) => p.querySelector<HTMLElement>('.rl-default:not(.on)')).find((x) => !!x) ?? null;
      const top = mach?.querySelector(':scope > .rl-mach-top');
      return { holes: [box, mach && !part.includes(mach) ? (top ? union([mach, top]) : mach) : null], pick };
    }
    const top = mach?.querySelector(':scope > .rl-mach-top');
    return { holes: [pill, mach && top ? union([mach, top]) : mach], pick: null };
  };

  /** Phần khung nhìn Modeler không bị bảng chọn máy / bảng Tổng hợp che (toạ độ màn hình). */
  const modelerBox = (): { x: number; y: number; w: number; h: number } | undefined => {
    const v = vis('.md-viewport')?.getBoundingClientRect();
    if (!v) return undefined;
    const pal = vis('.panel.left')?.getBoundingClientRect();
    const sum = summaryOpen() ? vis('.panel.right')?.getBoundingClientRect() : undefined;
    const l = Math.max(v.left, pal && pal.left < v.left + v.width / 2 ? pal.right : v.left);
    const r = Math.min(v.right, sum && sum.left > v.left + v.width / 2 ? sum.left : v.right);
    return r - l > 80 ? { x: l, y: v.top, w: r - l, h: v.height } : undefined;
  };
  /** Máy cuối của sơ đồ Modeler (ô số máy đã điền) — chỗ người dùng sửa mục tiêu. */
  const lastNode = (): HTMLElement | null => {
    if (mdFocus) {
      const n = document.querySelector<HTMLElement>(`.md-node[data-id="${CSS.escape(mdFocus)}"]`);
      if (n) return n;
    }
    const lim = [...document.querySelectorAll<HTMLInputElement>('.md-node .md-limit')].find((i) => i.value.trim() !== '') ?? null;
    return lim?.closest<HTMLElement>('.md-node') ?? vis('.md-node') ?? document.querySelector<HTMLElement>('.md-node');
  };
  /** Bảng chú thích dạng sơ đồ quanh máy Modeler đang phóng to: nhãn + đường nối tới từng phần của nút. */
  const callout = el('div', { class: 'tut-callout' });
  const NSC = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(NSC, 'svg');
  lines.setAttribute('class', 'tut-callout-lines');
  /** Nhãn đã dựng (giữ lại giữa các lần đo ⇒ hiệu ứng hiện ra chỉ chạy một lần). */
  const tags = new Map<string, HTMLElement>();
  const clearCallout = (): void => {
    callout.textContent = '';
    tags.clear();
  };
  const drawCallout = (): DOMRect[] => {
    const n = mdFocus ? lastNode() : null;
    if (!n || cur?.ch.id !== 'modeler') {
      if (callout.firstChild) clearCallout();
      return [];
    }
    if (!lines.isConnected) callout.append(lines);
    lines.setAttribute('width', String(innerWidth));
    lines.setAttribute('height', String(innerHeight));
    lines.textContent = '';
    const nb = n.getBoundingClientRect();
    // nhãn đặt bên trái / phải nút ngang tầm phần được chỉ; hai bên không đủ chỗ (điện thoại) ⇒ lên trên / xuống dưới
    const parts: { sel: string; label: string; side: 'left' | 'right' | 'up' | 'down'; up: boolean }[] = [
      { sel: '.md-side.left', label: tr('Input'), side: 'left', up: true },
      { sel: '.md-body', label: tr('Máy tham gia sản xuất'), side: 'up', up: true },
      { sel: '.md-side.right', label: tr('Output'), side: 'right', up: true },
      { sel: '.md-pct', label: tr('Công suất tối đa hiện tại'), side: 'left', up: false },
      { sel: '.md-limit', label: tr('Công suất kì vọng (điền số)'), side: 'down', up: false },
    ];
    const out: DOMRect[] = [];
    let downFell = false;
    for (const p of parts) {
      const r = n.querySelector(p.sel)?.getBoundingClientRect();
      if (!r || r.width < 1) {
        tags.get(p.sel)?.remove();
        tags.delete(p.sel);
        continue;
      }
      let tag = tags.get(p.sel);
      if (!tag) {
        tag = el('div', { class: `tut-tag${p.sel === '.md-limit' ? ' edit' : ''}` }, p.label);
        tags.set(p.sel, tag);
        callout.append(tag);
      }
      const w = tag.offsetWidth;
      const h = tag.offsetHeight;
      const px = r.left + r.width / 2;
      const py = r.top + r.height / 2;
      let side: string = p.side;
      if (side === 'left' && nb.left - w - 34 < 8) side = p.up ? 'up' : 'down';
      if (side === 'right' && nb.right + w + 34 > innerWidth - 8) side = p.up ? 'up' : 'down';
      let x: number;
      let y: number;
      if (side === 'left' || side === 'right') {
        x = side === 'left' ? nb.left - w - 30 : nb.right + 30;
        y = py - h / 2;
        for (const o of out) if (x < o.right + 6 && x + w > o.left - 6 && y < o.bottom + 4 && y + h > o.top - 4) y = o.bottom + 8;
      } else {
        x = Math.max(8, Math.min(innerWidth - w - 8, px - w / 2));
        y = side === 'up' ? nb.top - h - 26 : nb.bottom + 22;
        // nhãn chồng lên nhãn đã đặt ⇒ đẩy ra xa nút thêm một tầng
        for (const o of out) if (x < o.right + 6 && x + w > o.left - 6 && y < o.bottom + 4 && y + h > o.top - 4) y = side === 'up' ? o.top - h - 8 : o.bottom + 8;
      }
      y = Math.max(8, Math.min(innerHeight - h - 8, y));
      tag.style.left = `${Math.round(x)}px`;
      tag.style.top = `${Math.round(y)}px`;
      out.push(new DOMRect(x, y, w, h));
      // nhãn bên trái bị dồn xuống dưới (điện thoại) và nhãn dưới cùng: hai đường thẳng đứng chồng nhau ⇒ đi **vòng**: ra mép
      // trái / phải nút rồi kéo xuống, vào cạnh nhãn (người dùng 2026-10-13)
      const elbow = p.side === 'left' && side === 'down' ? 'L' : p.side === 'down' && downFell ? 'R' : null;
      if (p.side === 'left' && side === 'down') downFell = true;
      const [ex, ey] =
        elbow === 'L' ? [r.left + 2, py] : elbow === 'R' ? [r.right - 2, py] : side === 'left' ? [r.left + 2, py] : side === 'right' ? [r.right - 2, py] : [px, side === 'up' ? r.top + 2 : r.bottom - 2];
      const [sx, sy] = side === 'left' ? [x + w, y + h / 2] : side === 'right' ? [x, y + h / 2] : [x + w / 2, side === 'up' ? y + h : y];
      const line = document.createElementNS(NSC, 'path');
      const mid = y + h / 2;
      line.setAttribute(
        'd',
        elbow === 'L'
          ? `M${ex},${ey} H${nb.left - 12} V${mid} H${x}`
          : elbow === 'R'
            ? `M${ex},${ey} H${nb.right + 12} V${mid} H${x + w}`
            : `M${sx},${sy} L${ex},${ey}`,
      );
      const dot = document.createElementNS(NSC, 'circle');
      dot.setAttribute('cx', String(ex));
      dot.setAttribute('cy', String(ey));
      dot.setAttribute('r', '3.5');
      lines.append(line, dot);
    }
    return out;
  };

  const chapters: Chapter[] = [
    {
      id: 'start',
      title: tr('Làm quen'),
      when: () => !app.classList.contains('modeler-mode') && !app.classList.contains('sim-mode') && !document.querySelector('.rl-overlay, .bp-overlay'),
      steps: [
        {
          // kéo nút ở lề phải ra / vào, cuộn bảng chọn máy: không đổi bước (người dùng 2026-10-12, lần 3)
          // bảng Tổng hợp mở ra đẩy bảng chọn máy thu sát trái (điện thoại) ⇒ thôi khoanh bảng chọn máy; thu bảng Tổng hợp
          // lại ⇒ tự mở lại bảng chọn máy (người dùng 2026-10-12, lần 4)
          prepare: () => {
            openPalette();
            sumWas = summaryOpen();
          },
          tick: () => {
            const open = summaryOpen();
            if (sumWas && !open && !paletteOpen()) openPalette();
            sumWas = open;
          },
          targets: () => [paletteOpen() ? vis('.panel.left') : null, summaryOpen() ? vis('.panel.right') : null, handle()],
          text: () =>
            tr('Bên trái là **bảng chọn máy** — nơi bạn chọn công trình để đặt lên bản đồ.') +
            '\n' +
            tr('Bên phải là **bảng Tổng hợp** — lưu lượng và sản xuất AIC của bạn.'),
          hint: () => (touch() ? tr('Kéo nút ở lề phải để mở / thu gọn bảng Tổng hợp · vuốt danh sách để xem máy') : tr('Bấm nút ở lề phải để mở / thu gọn bảng Tổng hợp · lăn chuột để xem máy')),
        },
        {
          // nhập tìm máy được; khoanh mọi máy chưa ghim; ghim xong ⇒ bước sau
          kind: 'do',
          merge: true,
          prepare: () => {
            openPalette();
            pins0 = pinnedMachineIds(state.ds).length;
          },
          leave: clearHover,
          done: () => pinnedMachineIds(state.ds).length > pins0,
          targets: () => {
            const rows = unpinnedRows();
            for (const b of document.querySelectorAll('.panel.left button.machine.tut-hover')) if (!rows.includes(b as HTMLElement)) b.classList.remove('tut-hover');
            for (const b of rows) b.classList.add('tut-hover');
            const box = (vis('.panel.left .palette-list') ?? vis('.panel.left'))?.getBoundingClientRect();
            // tiêu đề nhóm máy cũng khoanh (khối sáng liền qua tên nhóm — người dùng 2026-10-12, lần 4); trừ nhóm Đã ghim
            const heads = [...document.querySelectorAll<HTMLElement>('.panel.left .pgroup:not([data-group="__pinned"]) > :first-child')];
            // phần bản đồ cũng sáng: kéo / chạm máy ra đặt được (người dùng 2026-10-13)
            return [vis('.panel.left .search'), ...[...rows, ...heads].map((b) => (box ? clip(b.getBoundingClientRect(), box) : null)), cameraRect()];
          },
          handAt: () => {
            // dòng hiện trọn đầu tiên (dòng bị tiêu đề nhóm dính trên che một nửa thì bỏ qua)
            const box = (vis('.panel.left .palette-list') ?? vis('.panel.left'))?.getBoundingClientRect();
            const rows = unpinnedRows();
            const full = box ? rows.find((b) => b.getBoundingClientRect().top > box.top + 30 && b.getBoundingClientRect().bottom < box.bottom) : undefined;
            return (full ?? rows[0])?.querySelector('.pin') ?? null;
          },
          text: () =>
            (touch()
              ? tr('**Tìm máy** theo tên ở ô tìm kiếm.') + '\n' + tr('**Chạm** một máy rồi chạm lên bản đồ để đặt.') + '\n' + tr('Hoặc **giữ và kéo** máy ra bản đồ.')
              : tr('**Tìm máy** theo tên ở ô tìm kiếm.') + '\n' + tr('**Bấm** một máy rồi bấm lên bản đồ để đặt.') + '\n' + tr('Hoặc **kéo** máy ra bản đồ.')) +
            '\n' +
            tr('Bấm **ghim** để đưa máy hay dùng lên đầu bảng.'),
          hint: () => tr('Ghim một máy bất kì để sang bước sau'),
          anim: 'tap',
        },
        {
          kind: 'do',
          prepare: openPalette,
          done: () => !paletteOpen(),
          targets: () => [vis('.panel.left .collapse-btn')],
          text: () =>
            tr('**Thu gọn** bảng chọn máy (nút «) để thấy máy vừa ghim nằm trên thanh thu gọn.') +
            (touch() ? '\n' + tr('Trên điện thoại cũng thu gọn được bằng cách vuốt bảng sang trái.') : ''),
          hint: () => tr('Bấm « để thu gọn bảng chọn máy'),
          anim: 'tap',
        },
        {
          // người dùng không bấm thu gọn (bấm sang bước) ⇒ tự thu gọn
          prepare: () => {
            if (paletteOpen()) window.dispatchEvent(new Event('efp:toggle-palette'));
          },
          targets: () => [vis('.panel.left')],
          text: () =>
            tr('Máy đã ghim nằm ở thanh thu gọn — bấm để cầm máy, hoặc phím **1 → 0** theo thứ tự.') +
            '\n' +
            tr('Bấm » (hoặc vuốt sang phải) để mở lại bảng.'),
          hint: () => tr('Bấm một máy đã ghim để cầm nó'),
        },
        {
          kind: 'do',
          // đang cầm máy (chọn ở bảng / thanh thu gọn bước trước) ⇒ hình xem trước chiếm con trỏ, không bấm được máy được
          // khoanh ⇒ bỏ máy đang cầm (người dùng 2026-10-13)
          prepare: () => {
            if (holding()) enterTool(state, renderer, { kind: 'select' });
          },
          done: () => state.selection !== null || state.sel.machines.size > 0,
          targets: () => [demoMachine('start')],
          text: () => tr('Giờ thử **chọn máy được khoanh** trên bản đồ.'),
          hint: () => tr('Chọn máy được khoanh để xem chi tiết'),
          anim: 'tap',
        },
      ],
    },
    {
      id: 'select',
      title: tr('Chọn máy'),
      when: () => state.tool.kind === 'select' && state.selection !== null && !app.classList.contains('sim-mode'),
      steps: [
        {
          // đóng / mở bảng chi tiết máy không đổi bước; chữ đổi theo trạng thái bảng
          targets: () => [vis('.machine-window:not(.collapsed)') ?? vis('.machine-window .mw-mini')],
          text: () =>
            mwOpen()
              ? tr('**Bảng chi tiết máy**: sản lượng, cổng vào / ra và công thức. Bấm "–" để thu gọn.')
              : tr('Bấm vào **biểu tượng máy** này để xem chi tiết: sản lượng, cổng và công thức.'),
          hint: () => (mwOpen() ? tr('Bấm "–" để thu gọn bảng chi tiết') : tr('Bấm biểu tượng máy để mở bảng chi tiết')),
          handAt: () => (mwOpen() ? vis('.machine-window .mw-collapse') : vis('.machine-window .mw-mini')),
          anim: 'tap',
        },
        {
          // tự thu gọn bảng chi tiết; bấm một nút thao tác ⇒ tắt lớp phủ cho làm thử; xong một lần ⇒ trả máy về chỗ cũ, sang bước
          prepare: () => {
            collapseMw();
            trial = { undo: undoLen(), uid: state.selection, busySeen: false, at: 0 };
          },
          leave: () => {
            trial = null;
            setSuspended(false);
          },
          onPass: (e) => {
            if ((e.target as Element).closest?.('.touch-actions, .dock, .float-acts')) startTrial();
          },
          tick: () => {
            if (!trial) return;
            const busyNow = holding() || dialogOpen();
            if (!suspended) {
              if (busyNow || undoLen() !== trial.undo) startTrial();
              else return;
            }
            if (busyNow) {
              trial.busySeen = true;
              return;
            }
            if (undoLen() !== trial.undo || trial.busySeen) return finishTrial();
            // bấm nút không làm gì (nút đang mờ…) ⇒ hiện lại hướng dẫn
            if (performance.now() - trial.at > 2500) setSuspended(false);
          },
          targets: () => [selectedRect(), vis('.touch-actions:not(.ta-out)') ?? vis('.dock > .dock-group:not(.dock-drawer):not(.dock-grip)')],
          text: () =>
            suspended
              ? tr('Làm thử thao tác — xong máy sẽ **tự về chỗ cũ**.')
              : tr('Máy đang chọn được **đánh dấu** trên bản đồ.') +
                '\n' +
                (touch()
                  ? tr('Thanh bên phải:') + '\n' + tr('**Xoay** · **Sao chép** · **Di chuyển**') + '\n' + tr('**Xoá** · **Lưu** bản vẽ') + '\n' + tr('Giữ 0,4 s trên máy để **nhấc lên** dời đi.')
                  : tr('Cột nút bên phải:') + '\n' + tr('**Lưu** · **Sao chép** ({0}) · **Di chuyển** ({1})', keyLabel('map.copy'), keyLabel('map.move')) + '\n' + tr('**Xoá** ({0}) · **Bật / tắt** ({1}) · **Xoay** ({2})', keyLabel('map.erase'), keyLabel('map.toggleOff'), keyLabel('map.rotate'))),
          hint: () => (suspended ? '' : tr('Bấm thử một nút thao tác — máy sẽ tự về chỗ cũ')),
        },
        {
          kind: 'do',
          // điện thoại: đang chọn máy thì thanh thao tác thế chỗ cột nút (có nút Mô phỏng) ⇒ bỏ chọn
          prepare: () => {
            if (touch() && !has('.topbar .top-sim, .dock .dock-sim')) state.select(null);
          },
          done: () => app.classList.contains('sim-mode'),
          targets: () => [vis('.tut-sim, .topbar .top-sim, .dock .dock-sim')],
          text: () => tr('Thử **chế độ Mô phỏng**: nhà máy chạy như trong game — hàng chạy trên băng, máy làm việc, kho đầy dần.'),
          hint: () => tr('Bấm Mô phỏng để chạy thử nhà máy'),
          anim: 'tap',
        },
      ],
    },
    {
      id: 'sim',
      title: tr('Mô phỏng'),
      when: () => app.classList.contains('sim-mode') && has('.sim-bar'),
      steps: [
        {
          // bấm các nút không đổi bước; bấm rồi ⇒ vùng sáng nở ra cả bản đồ để xem tác dụng
          prepare: () => (simTouched = false),
          onPass: (e) => {
            if ((e.target as Element).closest?.('.sim-bar')) simTouched = true;
          },
          targets: () => [vis('.sim-bar'), simTouched ? cameraRect() : null],
          text: () => tr('**Bảng điều khiển mô phỏng**:') + '\n' + tr('**Chạy / dừng** và chọn **tốc độ**') + '\n' + tr('**Tua** tới bất kỳ lúc nào trên thanh thời gian') + '\n' + tr('**Biểu đồ** sản lượng nạp vào kho'),
          hint: () => tr('Bấm thử các nút — bản đồ sáng lên để xem tác dụng'),
        },
        {
          // làm theo (chọn đúng máy được chỉ) ⇒ nhánh phụ: công thức đang chạy; sang bước thì cửa sổ máy tự thu gọn
          kind: 'do',
          prepare: () => {
            collapseMw();
            simSel = state.selection;
          },
          targets: () => [demoMachine('sim')],
          text: () => tr('**Chọn máy được khoanh** để xem công thức đang chạy và tiến độ trực tiếp.'),
          hint: () => tr('Chọn máy được khoanh để xem tiến độ'),
          anim: 'tap',
          branch: {
            when: () => state.selection !== null && state.selection !== simSel,
            step: {
              // cửa sổ máy đang thu gọn ⇒ mở ra để thấy công thức đang chạy
              prepare: () => {
                if (!mwOpen()) document.querySelector<HTMLElement>('.machine-window .mw-mini')?.click();
              },
              // điện thoại: thanh trên của cửa sổ máy — công thức đang chạy (mũi tên động) + sơ đồ máy
              targets: () =>
                touch()
                  ? [vis('.machine-window .mw-sheet-row') ?? vis('.machine-window .mw-card'), vis('.machine-window .mw-sim-prod')]
                  : [vis('.machine-window .rg-card.run') ?? vis('.machine-window .mp-row') ?? vis('.machine-window:not(.collapsed)')],
              text: () => tr('Đây là **công thức đang chạy**: thanh tiến độ chạy theo thời gian thật, số bên dưới là lưu lượng mỗi phút.'),
              leave: collapseMw,
            },
          },
        },
        {
          kind: 'do',
          done: () => !!document.querySelector('.rl-overlay'),
          prepare: () => {
            if (touch() && !has('.palette-head .recipes-btn')) openPalette();
          },
          targets: () => [vis('.tabbar .tb-recipes, .palette-head .recipes-btn')],
          text: () => tr('Mở **Thư viện công thức** (ba cuốn sách) để tra sản phẩm và chuỗi sản xuất.'),
          hint: () => tr('Bấm ba cuốn sách để mở Thư viện'),
          anim: 'tap',
        },
      ],
    },
    {
      id: 'library',
      title: tr('Thư viện công thức'),
      when: () => !!document.querySelector('.rl-overlay[data-view="list"]'),
      steps: [
        {
          kind: 'do',
          done: () => !!document.querySelector('.rl-overlay[data-view="item"]'),
          targets: () => [vis('.rl-list .rl-win') ?? vis('.rl-list .rl-entry')],
          text: () => tr('**Chọn một sản phẩm bất kỳ** để xem hồ sơ của nó.'),
          hint: () => tr('Chọn sản phẩm để xem hồ sơ'),
          anim: 'tap',
        },
      ],
    },
    {
      id: 'item',
      title: tr('Hồ sơ vật phẩm'),
      when: () => !!document.querySelector('.rl-overlay[data-view="item"]'),
      steps: [
        {
          kind: 'do',
          done: () => !!document.querySelector('.rl-overlay[data-view="chain"]'),
          targets: () => [vis('.rl-chain-btn'), vis('.rl-side-scroll')],
          text: () => tr('Bên phải là các cách làm ra sản phẩm và công thức dùng nó. Ấn **Xem Chuỗi** để xem chuỗi sản xuất tổng quát.'),
          hint: () => tr('Bấm Xem Chuỗi để xem chuỗi sản xuất'),
          anim: 'tap',
        },
      ],
    },
    {
      id: 'chain',
      title: tr('Chuỗi sản xuất'),
      when: () => !!document.querySelector('.rl-overlay[data-view="chain"]') && has('.rl-mach'),
      steps: [
        {
          // bấm máy / Công thức khác không đổi bước; ô khoanh nở theo nút vừa bấm
          prepare: () => (chainKeys = null),
          targets: () => chainTargets().holes,
          handAt: () => chainTargets().pick ?? chainTargets().holes[0] ?? null,
          text: () =>
            chainTargets().pick
              ? tr('Đây là các **cách làm khác**. Bấm **Đặt công thức mặc định** để dùng cách đó cho cả chuỗi.')
              : tr('Bấm **Công thức khác** để xem cách làm khác.') + '\n' + tr('Bấm **một máy** để xem đủ công thức.'),
          hint: () => (chainTargets().pick ? tr('Bấm Đặt công thức mặc định để đổi cách làm') : tr('Bấm Công thức khác hoặc một máy để mở rộng')),
          anim: 'tap',
        },
        {
          kind: 'do',
          done: () => !document.querySelector('.rl-overlay'),
          targets: () => [vis('.rl-model-btn')],
          text: () => tr('**Mô hình hoá**: đặt cả chuỗi lên sơ đồ Modeler.'),
          hint: () => tr('Bấm Mô hình hoá để mở chuỗi trong Modeler'),
          anim: 'tap',
        },
      ],
    },
    {
      id: 'modeler',
      title: tr('Modeler'),
      // sơ đồ có máy (kể cả đang nằm ngoài màn hình — bước đầu tự dời máy cuối vào giữa)
      when: () => app.classList.contains('modeler-mode') && !!document.querySelector('.md-node') && !document.querySelector('.rl-overlay, .bp-overlay'),
      steps: [
        {
          // bấm máy cuối ⇒ căn giữa, phóng to + bảng chú thích dạng sơ đồ; điền ô số máy được
          prepare: () => {
            mdFocus = null;
            // điện thoại: bảng Tổng hợp / bảng chọn máy phủ gần hết màn ⇒ thu lại cho thấy sơ đồ (bước sau mở lại bảng chọn máy)
            if (touch() && summaryOpen()) window.dispatchEvent(new Event('efp:toggle-summary'));
            if (touch() && paletteOpen()) window.dispatchEvent(new Event('efp:toggle-palette'));
            // máy cuối khuất sau bảng chọn máy / bảng Tổng hợp ⇒ dời sơ đồ cho nó vào giữa (giữ mức thu phóng) để bấm được
            setTimeout(() => {
              const n = lastNode();
              const r = n?.getBoundingClientRect();
              if (!n?.dataset.id || !r) return;
              const cx = r.left + r.width / 2;
              const cy = r.top + r.height / 2;
              const hit = document.elementFromPoint(cx, cy);
              // sơ đồ vừa "vừa màn hình" (chuỗi dài) ⇒ nút bé tí khó bấm: phóng lên cỡ bấm được
              const tiny = r.width < 110;
              if (!tiny && hit && n.contains(hit) && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) return;
              window.dispatchEvent(new CustomEvent(MODELER_FOCUS_EVENT, { detail: { id: n.dataset.id, box: modelerBox(), fill: tiny ? (touch() ? 0.42 : 0.22) : undefined } }));
              burst(700);
            }, 320);
          },
          leave: () => {
            mdFocus = null;
            clearCallout();
          },
          onPass: (e) => {
            const n = (e.target as Element).closest?.<HTMLElement>('.md-node');
            if (!n?.dataset.id || mdFocus === n.dataset.id) return;
            mdFocus = n.dataset.id;
            // điện thoại: thu gọn bảng chọn máy trước để máy phóng gần kín màn hình
            const fold = touch() && paletteOpen();
            if (fold) window.dispatchEvent(new Event('efp:toggle-palette'));
            const id = mdFocus;
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(MODELER_FOCUS_EVENT, { detail: { id, fill: touch() ? 0.86 : 0.42, box: modelerBox() } }));
              burst(900);
            }, fold ? 320 : 0);
            render();
          },
          avoid: drawCallout,
          targets: () => [lastNode()],
          text: () =>
            mdFocus
              ? tr('Sửa **Công suất kì vọng** (số máy) ở ô dưới — Modeler tính ngược ra cả dây chuyền cần bao nhiêu máy.')
              : tr('Sửa **số máy** ở ô dưới máy cuối để chọn mục tiêu — Modeler tính ngược ra cả dây chuyền cần bao nhiêu máy.'),
          hint: () => (mdFocus ? tr('Điền số vào ô Công suất kì vọng để tính lại') : tr('Bấm máy cuối để xem chú thích')),
          anim: () => (mdFocus ? undefined : 'tap'),
        },
        {
          prepare: openPalette,
          // khung sơ đồ Modeler cũng sáng: kéo máy vào đặt được (người dùng 2026-10-13)
          targets: () => {
            const b = modelerBox();
            return [vis('.panel.left'), b ? new DOMRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8) : null];
          },
          handAt: () => {
            const r = vis('.panel.left')?.getBoundingClientRect();
            return r ? new DOMRect(r.left + r.width / 2 - 1, r.top + r.height / 2 - 1, 2, 2) : null;
          },
          text: () => tr('Hoặc **tự xây** sơ đồ dây chuyền riêng: kéo máy từ bảng bên trái vào.'),
          hint: () => (touch() ? tr('Vuốt danh sách để xem máy · kéo một máy vào sơ đồ') : tr('Lăn chuột để xem máy · kéo một máy vào sơ đồ')),
          anim: 'drag',
        },
      ],
    },
  ];

  // ------------------------------------------------------------------ cửa sổ
  /** Chương đang hiện, bước đang ở, và đang ở nhánh phụ của bước đó không. */
  let cur: { ch: Chapter; i: number; inBranch: boolean } | null = null;
  const stepNow = (): Step | null => (cur ? (cur.inBranch ? cur.ch.steps[cur.i]!.branch!.step : cur.ch.steps[cur.i]!) : null);
  const kindOf = (s: Step): 'view' | 'do' => s.kind ?? 'view';
  /** Ô sáng đích (đã nới) của bước đang hiện — chạm xuyên qua đó được; `drawn` = ô đang vẽ (trượt dần tới đích). */
  let holes: DOMRect[] = [];
  let drawn: DOMRect[] = [];
  /** Tạm tắt lớp phủ (bước "Chọn máy 2": người dùng đang làm thử thao tác). */
  let suspended = false;

  const NS = 'http://www.w3.org/2000/svg';
  const root = el('div', { class: 'tut', hidden: true });
  const shade = document.createElementNS(NS, 'svg');
  shade.setAttribute('class', 'tut-shade');
  /**
   * Viền vàng: **một đường bao chung** cho các ô sáng chồng nhau (người dùng 2026-10-12, lần 4 — nút lồi + bảng Tổng hợp
   * là một hình, không phải hai khung đè nhau). Vẽ nét của mọi ô rồi che phần **bên trong** mọi ô ⇒ chỉ còn nửa ngoài của
   * nét nằm trên đường bao của hợp các ô.
   */
  const rings = document.createElementNS(NS, 'svg');
  rings.setAttribute('class', 'tut-rings');
  const hand = el('div', { class: 'tut-hand' });
  hand.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.9-2.6L4 14.9a1.5 1.5 0 0 1 2.4-1.8L9 15.5" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const ripple = el('div', { class: 'tut-ripple' });
  const title = el('div', { class: 'tut-title' });
  const count = el('span', { class: 'tut-count' });
  const body = el('div', { class: 'tut-text' });
  const hint = el('div', { class: 'tut-hint' });
  const prev = el('button', { class: 'tut-nav', type: 'button', title: tr('Bước trước') }, '‹');
  const next = el('button', { class: 'tut-nav next', type: 'button', title: tr('Bước sau') }, '›');
  const close = el('button', { class: 'tut-x', type: 'button', title: tr('Tắt hướng dẫn này') }, '×');
  const card = el('div', { class: 'tut-card' }, close, el('div', { class: 'tut-head' }, title, count), body, el('div', { class: 'tut-foot' }, prev, hint, next));
  root.append(shade, rings, callout, ripple, hand, card);
  document.body.append(root);

  const md = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const rectOf = (t: Target): DOMRect | null => {
    if (!t) return null;
    const r = t instanceof DOMRect ? t : t.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };

  /** Vẽ lớp tối + viền vàng theo `drawn`. */
  /**
   * Khung SVG của lớp tối + viền vàng dựng **một lần**; mỗi khung hình chỉ đặt lại toạ độ các ô (2026-10-13 — trước đây
   * dựng lại cả SVG bằng `innerHTML` mỗi khung hình: tốn và làm hiệu ứng nhấp nháy của viền chạy lại liên tục ⇒ giật).
   */
  const svgEl = (tag: string, attrs: Record<string, string>): SVGElement => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const shadeFull = svgEl('rect', { fill: '#fff' });
  const shadeHoles = svgEl('g', {});
  const shadeDim = svgEl('rect', { fill: 'rgba(4,7,11,0.74)', mask: 'url(#tut-mask)' });
  shade.append(svgEl('defs', {}), shadeDim);
  shade.firstChild!.appendChild(svgEl('mask', { id: 'tut-mask' })).append(shadeFull, shadeHoles);
  const ringFull = svgEl('rect', { fill: '#fff' });
  const ringHoles = svgEl('g', {});
  const ringLines = svgEl('g', { mask: 'url(#tut-ring-mask)', class: 'tut-ring-g' });
  rings.append(svgEl('defs', {}), ringLines);
  rings.firstChild!.appendChild(svgEl('mask', { id: 'tut-ring-mask' })).append(ringFull, ringHoles);
  /** Số ô của nhóm `g` đúng bằng `drawn`, mỗi ô đặt toạ độ mới. */
  const syncRects = (g: SVGElement, attrs: Record<string, string>): void => {
    while (g.childNodes.length > drawn.length) g.lastChild!.remove();
    while (g.childNodes.length < drawn.length) g.append(svgEl('rect', { rx: '10', ...attrs }));
    drawn.forEach((r, k) => {
      const e = g.childNodes[k] as SVGElement;
      e.setAttribute('x', String(r.left));
      e.setAttribute('y', String(r.top));
      e.setAttribute('width', String(r.width));
      e.setAttribute('height', String(r.height));
    });
  };
  const paint = (): void => {
    const W = String(innerWidth);
    const H = String(innerHeight);
    for (const e of [shade, rings, shadeFull, shadeDim, ringFull]) {
      if (e.getAttribute('width') !== W) e.setAttribute('width', W);
      if (e.getAttribute('height') !== H) e.setAttribute('height', H);
    }
    syncRects(shadeHoles, { fill: '#000' });
    syncRects(ringHoles, { fill: '#000' });
    syncRects(ringLines, { class: 'tut-ring-line' });
  };
  /** Ô sáng trượt / nở dần tới đích (ô mới mọc ra từ tâm của nó). */
  let raf = 0;
  const glide = (): void => {
    if (raf) return;
    const stepFrame = (): void => {
      raf = 0;
      if (!cur) return;
      while (drawn.length > holes.length) drawn.pop();
      for (let i = drawn.length; i < holes.length; i++) {
        const h = holes[i]!;
        drawn.push(new DOMRect(h.left + h.width / 2, h.top + h.height / 2, 0, 0));
      }
      let moving = false;
      drawn = drawn.map((d, i) => {
        const h = holes[i]!;
        const k = 0.24;
        const n = new DOMRect(d.left + (h.left - d.left) * k, d.top + (h.top - d.top) * k, d.width + (h.width - d.width) * k, d.height + (h.height - d.height) * k);
        if (Math.abs(n.left - h.left) + Math.abs(n.top - h.top) + Math.abs(n.width - h.width) + Math.abs(n.height - h.height) < 1) return h;
        moving = true;
        return n;
      });
      paint();
      if (moving) raf = requestAnimationFrame(stepFrame);
    };
    raf = requestAnimationFrame(stepFrame);
  };

  let handAnim: Animation | null = null;
  let lastAnimKey = '';
  const layout = (): void => {
    const step = stepNow();
    if (!cur || !step) return;
    const W = innerWidth;
    const H = innerHeight;
    const rs = step.targets().map(rectOf).filter((r): r is DOMRect => !!r);
    const pad = step.merge ? 3 : 6;
    const grown = rs.map((r) => new DOMRect(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2));
    holes = step.merge ? mergeRects(grown) : grown;
    glide();
    // thẻ chữ: về phía còn trống nhiều nhất quanh các đối tượng (và bảng chú thích)
    const keep = [...(step.merge ? holes : rs), ...(step.avoid?.() ?? [])];
    const cw = Math.min(360, W - 24);
    card.style.width = `${cw}px`;
    const ch = card.offsetHeight;
    let x = (W - cw) / 2;
    let y = (H - ch) / 2;
    // đang làm thử thao tác: thẻ ẩn (CSS `.tut.off`) — giữ nguyên chỗ, không nhảy đè lên nút người dùng vừa chạm
    if (suspended) return;
    // tổng **phần bị che** của từng đối tượng nhỏ (ô tìm kiếm bị che hết nặng hơn danh sách dài bị che một khúc)
    const small = keep.filter((r) => r.width * r.height < W * H * 0.4);
    const cover = (xx: number, yy: number): number =>
      small.reduce(
        (a, r) => a + (Math.max(0, Math.min(r.right, xx + cw) - Math.max(r.left, xx)) * Math.max(0, Math.min(r.bottom, yy + ch) - Math.max(r.top, yy))) / Math.max(1, r.width * r.height),
        0,
      );
    const webLandscape = touch() && !document.documentElement.classList.contains('native-app') && W > H;
    if (touch() && !webLandscape) {
      // điện thoại (người dùng 2026-10-13): thẻ **đứng yên ở đáy màn hình**, không nhảy chỗ theo từng bước; chỉ khi thẻ che
      // đúng chỗ phải chạm (bước "làm thử") thì lên đỉnh màn hình
      x = (W - cw) / 2;
      y = H - ch - 16;
      const a = (step.handAt ? rectOf(step.handAt()) : null) ?? rs[0];
      if (kindOf(step) === 'do' && a) {
        const cy = a.top + Math.min(a.height / 2, 40);
        if (cy > y - 8) y = 12;
      }
    } else if (!webLandscape) {
      // thẻ luôn ở **đáy màn hình** (người dùng 2026-10-12, lần 4): trái / giữa / phải — chỗ nào che ít nhất; chỗ nào cũng
      // che nặng ⇒ đẩy lên ngay trên đối tượng bị che
      const bottom = H - ch - 16;
      const xs = [...new Set([(W - cw) / 2, 12, W - cw - 12].map(Math.round))];
      x = xs.reduce((b, v) => (cover(v, bottom) < cover(b, bottom) - 0.01 ? v : b), xs[0]!);
      y = bottom;
      if (cover(x, y) > 0.5) {
        const hit = small.filter((r) => Math.min(r.right, x + cw) > Math.max(r.left, x) && r.bottom > y);
        y = Math.max(12, Math.min(...hit.map((r) => r.top)) - ch - 12);
      }
    } else if (keep.length) {
      // web điện thoại màn ngang: giữ cách cũ — về phía còn trống nhiều nhất quanh các đối tượng
      const u = { l: Math.min(...keep.map((r) => r.left)), t: Math.min(...keep.map((r) => r.top)), r: Math.max(...keep.map((r) => r.right)), b: Math.max(...keep.map((r) => r.bottom)) };
      const space = { right: W - u.r, left: u.l, below: H - u.b, above: u.t };
      const best = (Object.keys(space) as (keyof typeof space)[]).sort((a, b) => space[b] - space[a])[0]!;
      const cy = Math.max(12, Math.min(H - ch - 12, (u.t + u.b) / 2 - ch / 2));
      const cx = Math.max(12, Math.min(W - cw - 12, (u.l + u.r) / 2 - cw / 2));
      if (best === 'right' && space.right >= cw + 24) [x, y] = [u.r + 18, cy];
      else if (best === 'left' && space.left >= cw + 24) [x, y] = [u.l - cw - 18, cy];
      else if (space.right >= cw + 24) [x, y] = [u.r + 18, cy];
      else if (space.left >= cw + 24) [x, y] = [u.l - cw - 18, cy];
      else if (space.below >= ch + 24) [x, y] = [cx, u.b + 18];
      else if (space.above >= ch + 24) [x, y] = [cx, u.t - ch - 18];
      else [x, y] = [(W - cw) / 2, cover((W - cw) / 2, 12) < cover((W - cw) / 2, H - ch - 16) ? 12 : H - ch - 16];
    }
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
    // hoạt ảnh bàn tay
    const anim = suspended ? undefined : typeof step.anim === 'function' ? step.anim() : step.anim;
    const a = (step.handAt ? rectOf(step.handAt()) : null) ?? rs[0];
    const key = `${cur.ch.id}:${cur.i}:${cur.inBranch}:${anim ?? ''}:${a ? Math.round(a.left) + ',' + Math.round(a.top) : ''}`;
    if (key === lastAnimKey) return;
    lastAnimKey = key;
    handAnim?.cancel();
    hand.hidden = ripple.hidden = !anim || !a;
    if (!anim || !a) return;
    const p = { x: a.left + a.width / 2, y: a.top + Math.min(a.height / 2, 40) };
    ripple.style.left = `${p.x}px`;
    ripple.style.top = `${p.y}px`;
    if (anim === 'tap') {
      ripple.classList.add('on');
      handAnim = hand.animate(
        [
          { transform: `translate(${p.x}px, ${p.y + 26}px) scale(1)`, opacity: 0 },
          { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1, offset: 0.35 },
          { transform: `translate(${p.x}px, ${p.y}px) scale(0.86)`, offset: 0.5 },
          { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1, offset: 0.65 },
          { transform: `translate(${p.x}px, ${p.y + 26}px) scale(1)`, opacity: 0 },
        ],
        { duration: 1600, iterations: Infinity, easing: 'ease-in-out' },
      );
    } else {
      // kéo: từ đối tượng ra phần bản đồ đang thấy (bên phải bảng chọn máy)
      ripple.classList.remove('on');
      const c = (canvas()?.isConnected && canvas()!.getBoundingClientRect().width > 0 ? canvas() : vis('.md-viewport'))?.getBoundingClientRect();
      const left = Math.max(c?.left ?? 0, document.querySelector('.panel.left')?.getBoundingClientRect().right ?? 0);
      const right = Math.min(c?.right ?? W, W);
      const q = { x: (left + right) / 2, y: c ? c.top + c.height / 2 : H / 2 };
      handAnim = hand.animate(
        [
          { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 0 },
          { transform: `translate(${p.x}px, ${p.y}px) scale(0.86)`, opacity: 1, offset: 0.15 },
          { transform: `translate(${q.x}px, ${q.y}px) scale(0.86)`, opacity: 1, offset: 0.75 },
          { transform: `translate(${q.x}px, ${q.y}px) scale(1)`, opacity: 0 },
        ],
        { duration: 2200, iterations: Infinity, easing: 'ease-in-out' },
      );
    }
  };
  /** Đo lại liên tục một lúc (nút vừa bấm đang nở / bảng đang trượt). */
  let burstUntil = 0;
  let burstRaf = 0;
  const burst = (ms = 900): void => {
    burstUntil = Math.max(burstUntil, performance.now() + ms);
    if (burstRaf) return;
    const f = (): void => {
      burstRaf = 0;
      if (!cur) return;
      layout();
      if (performance.now() < burstUntil) burstRaf = requestAnimationFrame(f);
    };
    burstRaf = requestAnimationFrame(f);
  };

  let ticker: ReturnType<typeof setInterval> | null = null;
  let shownText = '';
  /** Chữ trên thẻ (đổi theo trạng thái — vd. cửa sổ máy đang mở / thu gọn). */
  const fillText = (): boolean => {
    const step = stepNow();
    if (!cur || !step) return false;
    const html = md(step.text());
    const h = suspended ? '' : (step.hint?.() ?? '');
    const sig = html + '|' + h;
    if (sig === shownText) return false;
    shownText = sig;
    body.innerHTML = html;
    hint.textContent = h;
    return true;
  };
  const render = (): void => {
    const step = stepNow();
    if (!cur || !step) return;
    const { ch, i } = cur;
    const n = ch.steps.length;
    title.textContent = ch.title;
    count.textContent = n > 1 ? `${i + 1} / ${n}` : '';
    shownText = '';
    fillText();
    root.classList.toggle('do', kindOf(step) === 'do');
    prev.disabled = i === 0 && !cur.inBranch;
    const last = i === n - 1 && !cur.inBranch;
    next.textContent = last ? tr('Đã hiểu') : '›';
    next.classList.toggle('done', last);
    lastAnimKey = '';
    layout();
    card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  };
  const setSuspended = (v: boolean): void => {
    if (suspended === v) return;
    suspended = v;
    root.classList.toggle('off', v);
    lastAnimKey = '';
    fillText();
    layout();
  };
  const startTrial = (): void => {
    if (!trial || suspended) return;
    trial.at = performance.now();
    trial.busySeen = false;
    setSuspended(true);
  };
  /** Làm xong một thao tác ở bước "Chọn máy 2": hoàn tác về như lúc vào bước, chọn lại máy cũ, sang bước sau. */
  const finishTrial = (): void => {
    if (!trial || !cur) return;
    const t = trial;
    trial = null;
    for (let k = 0; k < 50 && undoLen() > t.undo; k++) state.undo();
    if (t.uid !== null && state.bp.machines.some((m) => m.uid === t.uid)) state.select(t.uid);
    setSuspended(false);
    go(cur.i + 1);
  };
  /** Vào bước `i` của chương đang mở (chạy `prepare`, dọn bước cũ). */
  const go = (i: number): void => {
    if (!cur) return;
    const old = stepNow();
    old?.leave?.();
    if (cur.inBranch) cur.ch.steps[cur.i]!.leave?.();
    cur.inBranch = false;
    if (i >= cur.ch.steps.length) return hide();
    cur.i = Math.max(0, i);
    cur.ch.steps[cur.i]!.prepare?.();
    render();
    // đợi bảng vừa mở trượt ra rồi mới đo
    burst(600);
  };
  const show = (ch: Chapter): void => {
    cur = { ch, i: 0, inBranch: false };
    document.documentElement.dataset.tut = ch.id;
    drawn = [];
    if (!saved.seen.includes(ch.id)) saved.seen.push(ch.id);
    save();
    root.hidden = false;
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    ch.steps[0]!.prepare?.();
    render();
    burst(600);
    ticker = setInterval(tick, 300);
  };
  const hide = (): void => {
    if (!cur) return;
    const s = stepNow();
    s?.leave?.();
    if (cur.inBranch) cur.ch.steps[cur.i]!.leave?.();
    cur = null;
    delete document.documentElement.dataset.tut;
    holes = [];
    clearCallout();
    setSuspended(false);
    if (ticker) clearInterval(ticker);
    ticker = null;
    handAnim?.cancel();
    root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-in' }).onfinish = () => {
      if (!cur) root.hidden = true;
    };
  };
  /** Mỗi nhịp: đặt lại vị trí; bước `do` xong ⇒ sang bước; nhánh phụ xảy ra ⇒ hiện nhánh. */
  const tick = (): void => {
    if (!cur) return;
    // bộ lọc (người dùng 2026-10-12, lần 4): chương đang hiện hết đúng ngữ cảnh mà người dùng đã bấm tới chỗ của một chương
    // mới (vd. đang "Làm quen" bước 1 thì mở Thư viện trên điện thoại) ⇒ thôi chương cũ, hiện chương mới — không chồng nhau
    if (!suspended && !cur.ch.when()) {
      const now = cur.ch;
      const other = chapters.find((c) => c !== now && !saved.seen.includes(c.id) && c.when());
      if (other) {
        const s = stepNow();
        s?.leave?.();
        if (cur.inBranch) cur.ch.steps[cur.i]!.leave?.();
        if (ticker) clearInterval(ticker);
        ticker = null;
        cur = null;
        show(other);
        return;
      }
    }
    const main = cur.ch.steps[cur.i]!;
    if (!cur.inBranch && main.branch?.when()) {
      cur.inBranch = true;
      main.branch.step.prepare?.();
      render();
      burst(600);
      return;
    }
    const s = stepNow()!;
    s.tick?.();
    if (!cur || stepNow() !== s) return;
    if (!cur.inBranch && kindOf(s) === 'do' && s.done?.()) {
      go(cur.i + 1);
      return;
    }
    if (fillText()) lastAnimKey = '';
    layout();
  };
  const forward = (): void => {
    if (cur) go(cur.i + 1);
  };
  const back = (): void => {
    if (!cur) return;
    if (cur.inBranch) go(cur.i);
    else if (cur.i > 0) go(cur.i - 1);
  };
  prev.addEventListener('click', (e) => {
    e.stopPropagation();
    back();
  });
  next.addEventListener('click', (e) => {
    e.stopPropagation();
    forward();
  });
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    hide();
  });
  // chạm vào thẻ (bước "xem") ⇒ sang bước sau
  card.addEventListener('click', (e) => {
    if ((e.target as Element).closest('button')) return;
    const s = stepNow();
    if (s && kindOf(s) === 'view' && !suspended) forward();
  });
  // điện thoại: vuốt thẻ trái / phải ⇒ bước sau / trước
  let sw: { x: number; y: number } | null = null;
  card.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sw = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    if (!sw || !t) return;
    const dx = t.clientX - sw.x;
    const dy = t.clientY - sw.y;
    sw = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    e.preventDefault(); // không thành cú chạm "sang bước"
    if (dx < 0) forward();
    else back();
  });

  /**
   * Chặn thao tác ngoài thẻ. Cử chỉ **bắt đầu trong vùng sáng** (nhấn xuống) đi xuyên xuống app tới lúc nhấc tay — kể cả
   * khi kéo ra ngoài (kéo máy ra bản đồ); bắt đầu ngoài vùng sáng thì bị chặn, bước "xem" thì cú chạm đó sang bước sau.
   */
  const inHole = (x: number, y: number): boolean => holes.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  const pointOf = (e: Event): { x: number; y: number } | null => {
    if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return t ? { x: t.clientX, y: t.clientY } : null;
    }
    if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
    return null;
  };
  const DOWN = new Set(['pointerdown', 'mousedown', 'touchstart']);
  let passing = false;
  const gate = (e: Event): void => {
    // chỉ chặn thao tác thật của người dùng — cú bấm do chính hướng dẫn gửi (mở bảng, thu gọn cửa sổ máy…) phải đi qua
    if (!cur || suspended || !e.isTrusted || card.contains(e.target as Node)) return;
    const s = stepNow();
    if (!s) return;
    const p = pointOf(e);
    if (DOWN.has(e.type)) {
      passing = !!p && inHole(p.x, p.y);
      if (passing && e.type === 'pointerdown') {
        s.onPass?.(e);
        burst();
      }
    }
    if (passing || ((e.type === 'wheel' || e.type === 'contextmenu') && p && inHole(p.x, p.y))) {
      if (e.type === 'pointerup' || e.type === 'touchend' || e.type === 'wheel') burst();
      return;
    }
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
    if (kindOf(s) === 'view' && (e.type === 'click' || e.type === 'touchend')) forward();
  };
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'wheel'] as const)
    window.addEventListener(t, gate, { capture: true, passive: false });
  window.addEventListener('keydown', (e) => {
    if (!cur) return;
    // đang gõ (ô tìm máy, ô số máy Modeler…) ⇒ phím mũi tên / Esc là của ô đó
    const typing = (e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]');
    // phím đổi được (`keybinds.ts`): Esc đóng, Enter / → bước tiếp (người dùng 2026-10-13: thêm Enter), ← bước trước
    if (typing) return;
    if (matches('tutClose', e)) hide();
    else if (matches('tutNext', e) && !suspended) forward();
    else if (matches('tutBack', e) && !suspended) back();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener('resize', () => layout());

  // ------------------------------------------------------------------ điều kiện kích hoạt
  const busy = (): boolean =>
    app.classList.contains('touch-busy') ||
    state.tool.kind === 'place' ||
    state.tool.kind === 'group' ||
    !!document.querySelector('.tb-menu, .set-menu, .ip-panel, .md-dialog, .bp-dialog');
  let readyAt = performance.now() + 1500; // để giao diện dựng xong trước khi hiện chương đầu
  setInterval(() => {
    if (saved.off || cur || performance.now() < readyAt || busy()) return;
    const ch = chapters.find((c) => !saved.seen.includes(c.id) && c.when());
    if (ch) show(ch);
  }, 400);

  api = {
    reset() {
      saved = { off: false, seen: [] };
      save();
      readyAt = performance.now() + 400;
    },
  };
}

/** Dòng trong Cài đặt: bật / tắt hướng dẫn + "Xem lại từ đầu". */
export function tutorialSettingsRow(): HTMLElement {
  const box = el('input', { type: 'checkbox' });
  box.checked = !saved.off;
  box.addEventListener('change', () => {
    saved.off = !box.checked;
    save();
  });
  const again = el('button', { class: 'set-btn tut-reset', type: 'button', title: tr('Xem lại toàn bộ hướng dẫn từ đầu') }, tr('Xem lại từ đầu'));
  again.addEventListener('click', (e) => {
    e.stopPropagation();
    box.checked = true;
    api?.reset();
    // đóng bảng Cài đặt để chương "Làm quen" hiện ngay
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.querySelector<HTMLElement>('.tb-settings.open')?.click();
  });
  return el('div', { class: 'set-row set-tut' }, el('label', { class: 'set-check-row' }, box, el('span', {}, tr('Hướng dẫn sử dụng'))), again);
}
