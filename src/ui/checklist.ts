import { matches as keyMatches, matchesKey } from '../keybinds';
import { hotkeyOf } from '../editor/keys';
import type { AppState } from '../editor/state';
import type { TabManager } from '../editor/tabs';
import { CATALYST_ENV_LABEL, type RecipeDef } from '../model/types';
import { itemName } from '../model/dataset';
import { loadLibrary, saveLibrary, LIBRARY_EVENT } from '../blueprint/library';
import {
  buildChecklist,
  builtOf,
  orderRows,
  rowDone,
  rowLeft,
  setRowBuilt,
  subLeft,
  tickOne,
  untickOne,
  type Built,
  type CheckRow,
  type CheckSub,
} from '../modeler/checklist';
import type { MNode, ModelerDoc } from '../modeler/doc';
import { ENV_GASES, envOf, isEnvItem, kindOfNode, recipeOf } from '../modeler/doc';
import { itemIconSrc } from './itemPicker';
import { EMPTY_ICON, envIcon, envIconSrc } from './machineParts';
import { clear, el } from './dom';
import { confirmDialog } from './dialog';
import { tr } from '../i18n';

/**
 * **Checklist dây chuyền** (người dùng 2026-10-12) — giao diện. Dữ liệu ở `modeler/checklist.ts`.
 *
 * Một nút icon checklist ở **góc dưới trái** khung bản vẽ (bị bảng chọn máy đẩy sang phải; có nút con mắt / thanh điều
 * khiển mô phỏng thì đứng ngay trên nó — đổi chỗ có chuyển động) — cả bên Map lẫn bên Modeler. Ba trạng thái (có
 * animation chuyển qua lại):
 *  - **Ẩn**: chỉ còn nút icon;
 *  - **Mở**: bảng cỡ cửa sổ chi tiết máy, thanh dưới cao bằng nút (nút ẩn ở đúng chỗ nút icon · tìm kiếm · mở rộng ·
 *    Hủy — chỉ bên Map). Bên Modeler: checklist của sơ đồ đang mở. Bên Map: danh sách sơ đồ Modeler (tab cùng nhóm với
 *    map — map không thuộc nhóm nào thì mọi tab Modeler — và sơ đồ đã lưu trong Thư viện); Hủy ⇒ về danh sách;
 *  - **Mở rộng**: cửa sổ lớn, dòng xếp 2–4 cột theo bề rộng (điện thoại dọc: 1 cột), có nút **ghim**.
 * Mỗi dòng **một hàng**: `<còn lại>x [môi trường | icon máy | vào … → ra …] [dây chuyền] [◇]`. Các cột vào / mũi tên / ra
 * **thẳng hàng** giữa mọi dòng (ô trống giữ chỗ), icon to hết cỡ bề rộng cho phép (lần 2).
 *  - ◇ = **đã xây một máy** (trừ 1, theo thứ tự dòng con); bấm thẻ công thức = xây xong cả dòng (bấm lại = bỏ hết).
 *    Dấu tick vàng vẽ tràn viền hình thoi trong 0,5 s; xong cả dòng ⇒ thẻ tối đi, viền xanh lá, hình thoi tick xanh lá
 *    to ở giữa thẻ.
 *  - Icon dây chuyền ⇒ bảng các **dòng con**: mỗi nút + đường hàng tới sản phẩm cuối trên một hàng thẳng; công đoạn ở
 *    giữa thu thành "…" (giữa đường nối, nền trắng, không to hơn icon), bấm ⇒ thẻ công thức mở ra như ở Xem chuỗi.
 * Tìm kiếm: chỉ theo tên máy và tên món trong công thức.
 */

type Source = { kind: 'tab' | 'lib'; id: string };
interface Opened {
  title: string;
  doc: ModelerDoc;
  save(): void;
}
/** Bố cục cột của thẻ công thức (chung cho mọi dòng đang hiện ⇒ thẳng cột). */
interface Cols {
  inN: number;
  outN: number;
  /** Cỡ ô icon, px. */
  t: number;
}

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8.5l1.5 1.5L12 7.5M8 14.5l1.5 1.5 2.5-2.5M14.5 9h2M14.5 15h2"/></svg>';
const EXPAND_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
const PIN_ICON =
  '<svg viewBox="0 0 24 24"><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" fill="currentColor"/></svg>';
/**
 * Hình thoi (người dùng 2026-10-12, lần 3): **viền hình thoi** ngoài + **hình thoi đặc** bên trong, cách nhau một khoảng;
 * dấu tick **tràn viền** (đầu nét dài ra ngoài) vẽ hai lớp — lớp trắng to bên dưới làm viền, lớp màu bên trên.
 */
const DIAMOND =
  '<svg viewBox="0 0 24 24"><path class="cl-ring" d="M12 1.5L22.5 12 12 22.5 1.5 12z"/><path class="cl-dia" d="M12 4.3L19.7 12 12 19.7 4.3 12z"/>' +
  '<path class="cl-chk-o" pathLength="1" d="M5 11.6l5 5L23.6 2.6"/><path class="cl-chk" pathLength="1" d="M5 11.6l5 5L23.6 2.6"/></svg>';
/** Màu đoạn nối của một nút cấp hàng cho nhiều nơi (cùng nút ⇒ cùng màu). */
const FORK_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#9b6bdf', '#d6457f', '#2aa6b8', '#8a9a2b'];
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
const motion = (): boolean => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function mountChecklist(app: HTMLElement, state: AppState, tabs: TabManager): void {
  const ds = state.ds;
  const touch = (): boolean => document.documentElement.classList.contains('touch-ui');
  const portrait = (): boolean => touch() && innerHeight > innerWidth;
  const modeler = (): boolean => app.classList.contains('modeler-mode');

  let mode: 'hidden' | 'open' = 'hidden';
  let source: Source | null = null;
  let queryRaw = '';
  let query = '';
  /** Công đoạn "…" đang bung (khoá dòng con + chỉ số bước). */
  const unfolded = new Set<string>();
  /** Hiệu ứng chạy một lần ở lần vẽ tới: dòng vừa trừ một máy / vừa xây xong / công đoạn vừa bung. */
  const fx = { tick: new Set<string>(), done: new Set<string>(), unfold: '' };
  /** Vừa xây xong một dòng: giữ nguyên thứ tự ~1 s cho hiệu ứng tick xanh chạy hết, rồi mới dồn dòng đó xuống cuối. */
  let freeze: { keys: string[]; until: number } | null = null;
  const holdOrder = (o: Opened): void => {
    const { rows } = rowsOf(o);
    freeze = { keys: rows.map((r) => r.key), until: performance.now() + 1000 };
    setTimeout(() => {
      if (freeze && performance.now() >= freeze.until - 20) {
        freeze = null;
        refresh();
      }
    }, 1020);
  };

  // ------------------------------------------------------------------ nguồn dữ liệu
  /** Sơ đồ Modeler đang xem: bên Modeler là tab đang mở; bên Map là sơ đồ đã chọn trong danh sách. */
  const opened = (): Opened | null => {
    if (modeler()) {
      const t = tabs.active;
      return t.modeler ? { title: t.title, doc: t.modeler, save: () => tabs.persistSoon() } : null;
    }
    if (!source) return null;
    if (source.kind === 'tab') {
      const t = tabs.tabs.find((x) => x.id === source!.id);
      return t?.modeler ? { title: t.title, doc: t.modeler, save: () => tabs.persistSoon() } : null;
    }
    const b = loadLibrary().find((x) => x.id === source!.id);
    if (!b?.modeler) return null;
    const doc = b.modeler;
    return {
      title: b.name,
      doc,
      save: () => {
        // ghi lại vào đúng mục trong Thư viện (chỉ đổi số máy đã xây / ghim)
        const fresh = loadLibrary();
        const it = fresh.find((x) => x.id === b.id);
        if (!it?.modeler) return;
        it.modeler.built = doc.built;
        delete it.modeler.checks;
        it.modeler.checkPins = doc.checkPins;
        try {
          saveLibrary(fresh);
        } catch {
          /* hết chỗ: thôi */
        }
      },
    };
  };
  /** Danh sách sơ đồ cho bên Map: tab Modeler cùng nhóm (không nhóm ⇒ mọi tab Modeler) + sơ đồ đã lưu. */
  const sources = (): { tabs: { id: string; title: string }[]; lib: { id: string; name: string; icon: string | null }[] } => {
    const g = tabs.active.group;
    return {
      tabs: tabs.tabs.filter((t) => t.kind === 'modeler' && (!g || t.group === g)).map((t) => ({ id: t.id, title: t.title })),
      lib: loadLibrary()
        .filter((b) => b.kind === 'modeler' && b.modeler)
        .map((b) => ({ id: b.id, name: b.name, icon: b.icon })),
    };
  };
  const recipeFor = (n: MNode): RecipeDef | null => recipeOf(ds, n) ?? (n.ticks?.[0] ? (ds.recipes.get(n.ticks[0]) ?? null) : null);
  /** Vào / ra hiển thị của một dòng (máy nguồn: → vật phẩm; máy khuếch tán: khí →). */
  const ioOf = (machineId: string, recipe: RecipeDef | null, item?: string): { ins: { itemId: string; count?: number }[]; outs: { itemId: string; count?: number }[] } => {
    if (recipe) return { ins: recipe.ingredients, outs: recipe.outcomes };
    if (!item) return { ins: [], outs: [] };
    // máy khuếch tán: khí kích hoạt đi **vào**; máy nguồn: vật phẩm đi **ra**
    // máy khuếch tán: khí → **môi trường** (icon môi trường có vòng tròn — người dùng 2026-10-13)
    if (kindOfNode(ds, { id: '', machineId, recipeId: null, x: 0, y: 0, limit: null }) === 'env')
      return { ins: [{ itemId: item }], outs: ENV_GASES[item] ? [{ itemId: `@env:${ENV_GASES[item]}` }] : [] };
    return { ins: [], outs: [{ itemId: item }] };
  };
  /** Cột chung cho các dòng + cỡ icon lớn nhất vừa bề rộng `w` (px) của một dòng. */
  const colsFor = (list: { machineId: string; recipe: RecipeDef | null; item?: string }[], w: number, extra: number): Cols => {
    let inN = 1;
    let outN = 1;
    for (const r of list) {
      const io = ioOf(r.machineId, r.recipe, r.item);
      inN = Math.max(inN, io.ins.length);
      outN = Math.max(outN, io.outs.length);
    }
    const slots = 1 + inN + outN;
    // dòng = [đếm] [thẻ: máy | vào… mũi tên ra…] [công cụ]; khe giữa các ô 3px, mũi tên 30px, vạch ngăn 5px
    const t = Math.floor((w - extra - 30 - 5 - 3 * (slots + 1) - 10) / slots);
    return { inN, outN, t: Math.max(16, Math.min(40, t)) };
  };

  // ------------------------------------------------------------------ dựng một dòng
  // "vật phẩm" môi trường (máy khuếch tán làm ra): icon môi trường thật
  const tile = (id: string, count?: number): HTMLElement =>
    el(
      'span',
      { class: 'cl-tile', title: isEnvItem(id) ? tr('Môi trường {0}', CATALYST_ENV_LABEL[envOf(id) as keyof typeof CATALYST_ENV_LABEL] ?? envOf(id)) : itemName(ds, id) },
      el('img', { src: isEnvItem(id) ? envIconSrc(envOf(id)) : itemIconSrc(state, id), alt: '' }),
      count !== undefined && count !== 1 ? el('b', {}, String(count)) : null,
    );
  const emptyTile = (): HTMLElement => el('span', { class: 'cl-tile cl-empty-tile', title: tr('Trống') }, el('img', { src: EMPTY_ICON, alt: '' }));
  /**
   * Thẻ công thức: `[môi trường] icon máy | vào … mũi tên … ra` — lưới cột cố định (ô trống giữ chỗ) ⇒ mũi tên và các ô
   * thẳng cột giữa mọi thẻ cùng bố cục `cols`.
   */
  const card = (machineId: string, recipe: RecipeDef | null, item: string | undefined, cols: Cols, given?: ReturnType<typeof ioOf>): HTMLElement => {
    const def = ds.machines.get(machineId);
    const env = recipe && recipe.catalystEnv !== 'None' ? recipe.catalystEnv : null;
    const io = given ?? ioOf(machineId, recipe, item);
    const arrow = el('span', { class: 'cl-arrow' }, el('span', { class: 'cl-time' }, recipe ? `${recipe.seconds}s` : ''));
    arrow.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 30 8" preserveAspectRatio="none"><path d="M1 4h24" stroke="currentColor" stroke-width="1.6"/><path d="M24 0.5l5 3.5-5 3.5z" fill="currentColor"/></svg>');
    const gap = (): HTMLElement => el('span', { class: 'cl-slot' });
    const c = el(
      'div',
      {
        class: `cl-card${env ? ` env env-${env.toLowerCase()}` : ''}`,
        style: `--t:${cols.t}px;grid-template-columns:var(--t) 5px repeat(${cols.inN}, var(--t)) 30px repeat(${cols.outN}, var(--t))`,
        title: def?.name ?? machineId,
      },
      env ? el('div', { class: 'cl-env' }, envIcon(env), `${tr('MÔI TRƯỜNG')} ${CATALYST_ENV_LABEL[env].toUpperCase()}`) : null,
      el('span', { class: 'cl-mach' }, def ? el('img', { src: `img/items/${def.icon}.png`, alt: '' }) : null),
      el('span', { class: 'cl-sep' }),
      // vào: dồn sát mũi tên (ô trống ở đầu); bên không có món nào (máy nguồn → ra, vào → máy khuếch tán) ⇒ icon Empty
      // sát mũi tên (người dùng 2026-10-12, lần 3)
      ...Array.from({ length: cols.inN - Math.max(1, io.ins.length) }, gap),
      ...(io.ins.length ? io.ins.map((s) => tile(s.itemId, s.count)) : [emptyTile()]),
      arrow,
      ...(io.outs.length ? io.outs.map((s) => tile(s.itemId, s.count)) : [emptyTile()]),
      ...Array.from({ length: cols.outN - Math.max(1, io.outs.length) }, gap),
    );
    return c;
  };
  const diamond = (cls: string, title: string, onClick: () => void): HTMLElement => {
    const b = el('button', { class: `cl-tick ${cls}`, type: 'button', title });
    b.innerHTML = DIAMOND;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  /** Dấu hoàn thành phủ giữa thẻ công thức (hình thoi xanh lá tick tràn viền). */
  const doneMark = (): HTMLElement => {
    const m = el('span', { class: 'cl-done-mark' });
    m.innerHTML = DIAMOND;
    return m;
  };

  const save = (o: Opened, built: Built): void => {
    if (fx.done.size) holdOrder(o);
    o.doc.built = built;
    delete o.doc.checks;
    o.save();
    refresh();
  };
  const togglePin = (o: Opened, key: string): void => {
    const s = new Set(o.doc.checkPins ?? []);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    o.doc.checkPins = [...s];
    o.save();
    refresh();
  };
  const matches = (r: CheckRow): boolean => {
    if (!query) return true;
    const names = [ds.machines.get(r.machineId)?.name ?? r.machineId, ...(r.recipe ? [...r.recipe.ingredients, ...r.recipe.outcomes].map((s) => itemName(ds, s.itemId)) : []), r.item ? itemName(ds, r.item) : ''];
    return names.some((x) => fold(x).includes(query));
  };
  /** Dòng chính: ◇ trừ một máy (đủ rồi ⇒ bỏ một máy); bấm thẻ ⇒ xây xong / bỏ hết. */
  const rowView = (o: Opened, r: CheckRow, built: Built, cols: Cols, big: boolean): HTMLElement => {
    const done = rowDone(r, built);
    const left = rowLeft(r, built);
    const pinned = (o.doc.checkPins ?? []).includes(r.key);
    const chain = el('button', { class: 'cl-chain', type: 'button', title: tr('Xem các dây chuyền dùng máy + công thức này') }, el('span', { class: 'cl-chain-ico' }));
    chain.addEventListener('click', (e) => {
      e.stopPropagation();
      openSubs(o, r.key, chain);
    });
    const pin = big
      ? (() => {
          const b = el('button', { class: `cl-pin${pinned ? ' on' : ''}`, type: 'button', title: pinned ? tr('Bỏ ghim') : tr('Ghim lên đầu') });
          b.innerHTML = PIN_ICON;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(o, r.key);
          });
          return b;
        })()
      : null;
    const c = card(r.machineId, r.recipe, r.item, cols);
    c.classList.add('cl-press');
    // rê chuột: tên máy (người dùng 2026-10-13 — trước là "Bấm: đã xây xong…")
    c.title = ds.machines.get(r.machineId)?.name ?? r.machineId;
    c.addEventListener('click', () => {
      const b = { ...built };
      setRowBuilt(r.subs, b, !done);
      if (!done) fx.done.add(r.key);
      save(o, b);
    });
    if (done) {
      c.classList.add('done');
      c.append(doneMark());
      if (fx.done.has(r.key)) c.classList.add('fx');
    }
    const tick = diamond(`${done ? 'on' : ''}${fx.tick.has(r.key) ? ' flash' : ''}${fx.done.has(r.key) ? ' fx' : ''}`, done ? tr('Bỏ một máy đã xây') : tr('Đã xây một máy'), () => {
      const b = { ...built };
      if (done) untickOne(r, b);
      else {
        tickOne(r, b);
        if (rowDone(r, b)) fx.done.add(r.key);
        else fx.tick.add(r.key);
      }
      save(o, b);
    });
    return el(
      'div',
      { class: `cl-row${done ? ' done' : ''}${pinned ? ' pinned' : ''}`, 'data-k': r.key },
      el('span', { class: 'cl-count' }, el('b', {}, `${done ? r.count : left}x`), left !== r.count && !done ? el('small', {}, `/${r.count}`) : null),
      c,
      el('span', { class: 'cl-row-tools' }, pin, chain, tick),
    );
  };
  const rowsOf = (o: Opened): { rows: CheckRow[]; built: Built } => {
    const rows = buildChecklist(ds, o.doc);
    const built = builtOf(rows, o.doc);
    let order = orderRows(rows, built, new Set(o.doc.checkPins ?? []));
    if (freeze && performance.now() < freeze.until) {
      const at = new Map(freeze.keys.map((k, i) => [k, i]));
      order = [...order].sort((a, b) => (at.get(a.key) ?? 1e9) - (at.get(b.key) ?? 1e9));
    }
    return { rows: order, built };
  };
  /** Danh sách dòng vào `box` (`width` = bề rộng một cột, `n` = số cột). */
  const fillList = (box: HTMLElement, o: Opened, width: number, n: number, big: boolean): void => {
    // FLIP: dòng đổi chỗ (xong ⇒ xuống cuối, ghim ⇒ lên đầu) trượt tới chỗ mới
    const before = new Map<string, DOMRect>();
    for (const e of box.querySelectorAll<HTMLElement>(':scope > .cl-row')) before.set(e.dataset.k!, e.getBoundingClientRect());
    clear(box);
    const { rows: all, built } = rowsOf(o);
    const rows = all.filter(matches);
    if (o.doc.nodes.length === 0) box.append(el('div', { class: 'cl-empty' }, tr('Sơ đồ Modeler này chưa có máy nào.')));
    else if (rows.length === 0) box.append(el('div', { class: 'cl-empty' }, tr('Không có dòng nào khớp')));
    // bề phần ngoài thẻ: số lượng, công cụ 2–3 nút, khe giữa 3 phần — điện thoại gọn hơn để icon to hơn (lần 4)
    const cols = touch() ? colsFor(all, width + 4, 30 + (big ? 84 : 56) + 6) : colsFor(all, width, 44 + (big ? 94 : 64) + 18);
    // cột số lượng vừa đúng số dài nhất ("12x") — không thừa khoảng trước số, vẫn thẳng cột (người dùng 2026-10-13)
    const longest = Math.max(2, ...rows.map((r) => `${r.count}x`.length));
    box.style.setProperty('--cw', `${longest * 0.62 + 0.2}em`);
    // cột vừa đúng nội dung (không kéo giãn ⇒ không thừa khoảng giữa thẻ và nút — người dùng 2026-10-13)
    box.style.gridTemplateColumns = `repeat(${n}, max-content)`;
    // nhiều cột: xếp **dọc theo từng cột** (đọc từ trên xuống như checklist), không xen kẽ trái → phải
    box.style.gridTemplateRows = n > 1 ? `repeat(${Math.max(1, Math.ceil(rows.length / n))}, auto)` : '';
    box.style.gridAutoFlow = n > 1 ? 'column' : '';
    for (const r of rows) box.append(rowView(o, r, built, cols, big));
    if (!motion() || before.size === 0) return;
    for (const e of box.querySelectorAll<HTMLElement>(':scope > .cl-row')) {
      const old = before.get(e.dataset.k!);
      if (!old) continue;
      const now = e.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      // dòng vừa xây xong trượt xuống cuối, **nổi trên** các dòng bị đẩy lên lấp chỗ (người dùng 2026-10-12, lần 4)
      const down = dy < -1;
      if (down) e.classList.add('cl-moving');
      const a = e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: down ? 560 : 460, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' });
      if (down) a.onfinish = a.oncancel = () => e.classList.remove('cl-moving');
    }
  };

  // ------------------------------------------------------------------ bảng dây chuyền con
  let subsOpen: string | null = null;
  /** Nút dây chuyền đã mở bảng con — đóng thì thu về đó. */
  let subsFrom: DOMRect | null = null;
  const subOverlay = el('div', { class: 'cl-overlay cl-subs', hidden: true });
  document.body.append(subOverlay);
  const openSubs = (o: Opened, key: string, from: HTMLElement): void => {
    subsOpen = key;
    subsFrom = from.getBoundingClientRect();
    drawSubs(o);
    grow(subOverlay.querySelector('.cl-window'), subsFrom);
    if (motion()) subOverlay.animate([{ backgroundColor: 'rgba(4, 6, 10, 0)' }, { backgroundColor: 'rgba(4, 6, 10, 0.62)' }], { duration: 260 });
  };
  /** Đóng bảng con: thu về nút dây chuyền đã mở nó (animation đóng — người dùng 2026-10-12). */
  const closeSubs = (): void => {
    if (!subsOpen) return;
    subsOpen = null;
    const end = (): void => {
      if (subsOpen) return;
      subOverlay.hidden = true;
      clear(subOverlay);
    };
    const a = grow(subOverlay.querySelector('.cl-window'), subsFrom, true);
    if (!a) return end();
    subOverlay.animate([{ backgroundColor: 'rgba(4, 6, 10, 0.62)' }, { backgroundColor: 'rgba(4, 6, 10, 0)' }], { duration: 200, fill: 'forwards' });
    a.onfinish = end;
    setTimeout(end, 260); // dự phòng: trang bị ẩn thì animation không chạy tới cuối
  };
  subOverlay.addEventListener('click', (e) => {
    if (e.target === subOverlay) closeSubs();
  });
  const subRow = (o: Opened, s: CheckSub, built: Built, cols: Cols, r: CheckRow): HTMLElement => {
    const byId = new Map(o.doc.nodes.map((n) => [n.id, n]));
    const n = byId.get(s.node);
    const line = el('div', { class: 'cl-path' });
    const left = subLeft(s, built);
    const done = s.count > 0 && left === 0;
    if (n) {
      const c = card(n.machineId, recipeFor(n), n.item, cols);
      c.classList.add('cl-press');
      c.dataset.k = 'head';
      c.addEventListener('click', () => {
        const b = { ...built };
        setRowBuilt([s], b, !done);
        if (!done) fx.done.add(s.key);
        if (rowDone(r, b)) fx.done.add(r.key);
        save(o, b);
      });
      if (done) {
        c.classList.add('done');
        c.append(doneMark());
        if (fx.done.has(s.key)) c.classList.add('fx');
      }
      line.append(c);
    }
    const one: Cols = { inN: 1, outN: 1, t: cols.t };
    /** Bước trước là thẻ công thức đã bung (cần đoạn nối riêng tới ô sau); sau "…" thì đoạn có "…" đã nối thẳng tới ô sau. */
    let afterCard = true;
    s.path.forEach((step, i) => {
      const first = i === 0;
      if (afterCard) line.append(el('span', { class: 'cl-link', 'data-k': `l${i}`, style: first && s.fork !== null ? `--fork:${FORK_COLORS[s.fork % FORK_COLORS.length]}` : '' }));
      afterCard = false;
      const t = tile(step.item);
      t.dataset.k = `t${i}`;
      line.append(t);
      if (!step.node) return;
      const m = byId.get(step.node);
      const k = `${s.key}#${i}`;
      if (m && unfolded.has(k)) {
        line.append(el('span', { class: 'cl-link', 'data-k': `m${i}` }));
        const rm = recipeFor(m);
        // máy không có công thức (máy xử lý, cửa nạp…): món đi vào → món đi ra theo đường nối
        const next = s.path[i + 1]?.item;
        const io = rm ? undefined : { ins: [{ itemId: step.item }], outs: next ? [{ itemId: next }] : [] };
        const c = card(m.machineId, rm, m.item, { ...one, inN: Math.max(1, rm?.ingredients.length ?? 1), outN: Math.max(1, rm?.outcomes.length ?? 1) }, io);
        c.classList.add('cl-unfolded');
        afterCard = true;
        c.dataset.k = `c${i}`;
        c.title = tr('Bấm: thu gọn');
        c.addEventListener('click', () => {
          unfolded.delete(k);
          drawSubs(o);
        });
        line.append(c);
      } else {
        // "…" nằm **giữa** đường nối tới ô sau (người dùng 2026-10-12, lần 2)
        const dots = el('button', { class: 'cl-dots', type: 'button', title: m ? tr('{0} — bấm để xem công thức', ds.machines.get(m.machineId)?.name ?? m.machineId) : '' }, '…');
        dots.addEventListener('click', () => {
          unfolded.add(k);
          fx.unfold = `c${i}|${s.key}`;
          drawSubs(o);
        });
        line.append(el('span', { class: 'cl-link cl-link-dots', 'data-k': `m${i}` }, dots));
      }
    });
    const tick = diamond(`${done ? 'on' : ''}${fx.tick.has(s.key) ? ' flash' : ''}${fx.done.has(s.key) ? ' fx' : ''}`, done ? tr('Bỏ một máy đã xây') : tr('Đã xây một máy'), () => {
      const b = { ...built };
      if (done) b[s.key] = Math.max(0, (b[s.key] ?? 0) - 1);
      else {
        b[s.key] = (b[s.key] ?? 0) + 1;
        if (subLeft(s, b) > 0) fx.tick.add(s.key);
        else fx.done.add(s.key);
      }
      if (rowDone(r, b)) fx.done.add(r.key);
      save(o, b);
    });
    return el(
      'div',
      { class: `cl-subrow${done ? ' done' : ''}`, 'data-s': s.key },
      tick,
      el('span', { class: 'cl-count' }, el('b', {}, `${done ? s.count : left}x`), left !== s.count && !done ? el('small', {}, `/${s.count}`) : null),
      line,
    );
  };
  const drawSubs = (o: Opened): void => {
    const rows = buildChecklist(ds, o.doc);
    const r = rows.find((x) => x.key === subsOpen);
    if (!r) return closeSubs();
    const built = builtOf(rows, o.doc);
    // FLIP: vị trí cũ của từng phần tử trên mỗi dòng ⇒ phần tử bị thẻ vừa bung đẩy ra thì trượt tới chỗ mới
    const before = new Map<string, number>();
    for (const e of subOverlay.querySelectorAll<HTMLElement>('.cl-subrow [data-k]')) before.set(`${e.closest<HTMLElement>('.cl-subrow')!.dataset.s}|${e.dataset.k}`, e.getBoundingClientRect().left);
    const oldList = subOverlay.querySelector('.cl-subs-list');
    const scroll = oldList ? { x: oldList.scrollLeft, y: oldList.scrollTop } : null;
    clear(subOverlay);
    const x = el('button', { class: 'cl-x', type: 'button', title: tr('Đóng') }, '×');
    x.addEventListener('click', closeSubs);
    const width = Math.min(1100, innerWidth * (touch() ? 1 : 0.94));
    const cols = colsFor([r], Math.min(width, 520), 0);
    const done = rowDone(r, built);
    const head = card(r.machineId, r.recipe, r.item, cols);
    if (done) {
      head.classList.add('done');
      head.append(doneMark());
      if (fx.done.has(r.key)) head.classList.add('fx');
    }
    const cw = Math.max(2, ...r.subs.map((x) => `${x.count}x`.length)) * 0.62 + 0.2;
    const list = el('div', { class: 'cl-subs-list', style: `--t:${cols.t}px;--cw:${cw}em` }, ...r.subs.map((s) => subRow(o, s, built, cols, r)));
    subOverlay.append(
      el(
        'div',
        { class: 'cl-window' },
        el('div', { class: 'cl-head' }, el('span', { class: 'cl-title' }, tr('Dây chuyền dùng máy này')), el('span', { class: 'cl-sub-total' }, `${rowLeft(r, built)}/${r.count}`), x),
        el('div', { class: 'cl-subs-top' }, head),
        list,
        el('div', { class: 'cl-hint' }, tr('Bấm "…" để xem công thức của công đoạn ở giữa · màu đường nối giống nhau = cùng một máy cấp hàng cho nhiều nơi')),
      ),
    );
    subOverlay.hidden = false;
    if (scroll) {
      list.scrollLeft = scroll.x;
      list.scrollTop = scroll.y;
    }
    if (!motion()) return;
    for (const e of subOverlay.querySelectorAll<HTMLElement>('.cl-subrow [data-k]')) {
      const id = `${e.closest<HTMLElement>('.cl-subrow')!.dataset.s}|${e.dataset.k}`;
      const old = before.get(id);
      if (old === undefined) continue;
      const dx = old - e.getBoundingClientRect().left;
      if (Math.abs(dx) > 0.5) e.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 300, easing: EASE });
    }
    if (fx.unfold) {
      // thẻ công thức vừa bung: hiện ra từ chỗ dấu "…" rồi lớn dần sang phải (như mở thẻ máy ở Xem chuỗi)
      const [k, s] = fx.unfold.split('|');
      const c = [...subOverlay.querySelectorAll<HTMLElement>(`.cl-subrow [data-k="${k}"]`)].find((e) => e.closest<HTMLElement>('.cl-subrow')!.dataset.s === s);
      c?.animate(
        [
          { clipPath: 'inset(0 100% 0 0 round 6px)', opacity: 0.4, transform: 'scale(0.9)' },
          { clipPath: 'inset(0 0 0 0 round 6px)', opacity: 1, transform: 'none' },
        ],
        { duration: 320, easing: EASE },
      );
      fx.unfold = '';
    }
  };

  // ------------------------------------------------------------------ cửa sổ mở rộng
  const bigOverlay = el('div', { class: 'cl-overlay cl-big', hidden: true });
  document.body.append(bigOverlay);
  let bigOpen = false;
  let bigList: HTMLElement | null = null;
  /** Cửa sổ lớn mở ra từ khung `from` (bảng nhỏ / nút) — và thu về đó khi đóng. */
  const grow = (win: Element | null, from: DOMRect | null, back = false): Animation | null => {
    if (!win || !from || !motion()) return null;
    const to = win.getBoundingClientRect();
    const k = [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: back ? 0 : 0.3 }, { transform: 'none', opacity: 1 }];
    return (win as HTMLElement).animate(back ? k.reverse() : k, { duration: back ? 200 : 280, easing: back ? 'ease-in' : EASE, fill: 'both' });
  };
  const closeBig = (): void => {
    if (!bigOpen) return;
    bigOpen = false;
    const a = grow(bigOverlay.querySelector('.cl-window'), panel.hidden ? fab.getBoundingClientRect() : panel.getBoundingClientRect(), true);
    bigOverlay.animate([{ backgroundColor: 'rgba(4, 6, 10, 0.62)' }, { backgroundColor: 'rgba(4, 6, 10, 0)' }], { duration: 200 });
    const end = (): void => {
      if (bigOpen) return;
      bigOverlay.hidden = true;
      clear(bigOverlay);
      bigList = null;
    };
    if (a) {
      a.onfinish = end;
      setTimeout(end, 260);
    } else end();
  };
  bigOverlay.addEventListener('click', (e) => {
    if (e.target === bigOverlay) closeBig();
  });
  /** Số cột của cửa sổ mở rộng: 2–4 theo bề rộng; điện thoại dọc 1 cột. */
  const bigCols = (w: number): number => (portrait() ? 1 : Math.max(1, Math.min(4, Math.floor(w / 470))));
  const fillBig = (): void => {
    const o = opened();
    if (!o || !bigList) return closeBig();
    const w = bigList.clientWidth - 24;
    const n = bigCols(w);
    fillList(bigList, o, (w - (n - 1) * 12) / n, n, true);
  };
  const openBig = (): void => {
    const o = opened();
    if (!o) return;
    bigOpen = true;
    clear(bigOverlay);
    const x = el('button', { class: 'cl-x', type: 'button', title: tr('Đóng') }, '×');
    x.addEventListener('click', closeBig);
    bigList = el('div', { class: 'cl-list cl-big-list' });
    bigOverlay.append(
      el('div', { class: 'cl-window' }, el('div', { class: 'cl-head' }, el('span', { class: 'cl-title' }, tr('Checklist dây chuyền — {0}', o.title)), searchBox(), x), el('div', { class: 'cl-big-scroll' }, bigList)),
    );
    bigOverlay.hidden = false;
    fillBig();
    grow(bigOverlay.querySelector('.cl-window'), panel.getBoundingClientRect());
    if (motion()) bigOverlay.animate([{ backgroundColor: 'rgba(4, 6, 10, 0)' }, { backgroundColor: 'rgba(4, 6, 10, 0.62)' }], { duration: 260 });
  };

  // ------------------------------------------------------------------ nút + bảng nhỏ
  const fab = el('button', { class: 'cl-fab', type: 'button', title: tr('Checklist dây chuyền') });
  fab.innerHTML = CHECK_ICON;
  const panel = el('div', { class: 'cl-panel', hidden: true });
  const body = el('div', { class: 'cl-body' });
  const bar = el('div', { class: 'cl-bar' });
  panel.append(body, bar);
  document.body.append(panel, fab);

  /** Ô tìm kiếm (bảng nhỏ và cửa sổ lớn dùng chung chữ đang tìm). Gõ không dựng lại ô ⇒ dấu cách, bộ gõ tiếng Việt giữ nguyên. */
  function searchBox(): HTMLInputElement {
    const s = el('input', { class: 'cl-search', type: 'search', placeholder: tr('Tìm máy / công thức…') }) as HTMLInputElement;
    s.value = queryRaw;
    s.addEventListener('input', () => {
      queryRaw = s.value;
      query = fold(queryRaw.trim());
      for (const other of document.querySelectorAll<HTMLInputElement>('.cl-search')) if (other !== s) other.value = queryRaw;
      refresh();
    });
    return s;
  }
  const drawBar = (): void => {
    clear(bar);
    const hide = el('button', { class: 'cl-bar-btn cl-hide on', type: 'button', title: tr('Ẩn checklist') });
    hide.innerHTML = CHECK_ICON;
    hide.addEventListener('click', () => setMode('hidden'));
    const big = el('button', { class: 'cl-bar-btn', type: 'button', title: tr('Mở rộng') });
    big.innerHTML = EXPAND_ICON;
    big.disabled = !opened();
    big.addEventListener('click', openBig);
    bar.append(hide, searchBox(), big);
    if (!modeler() && source)
      bar.append(
        el('button', {
          class: 'cl-bar-btn cl-cancel',
          type: 'button',
          title: tr('Hủy — bỏ hết các máy đã đánh dấu xây, về danh sách sơ đồ'),
          onclick: async () => {
            // Hủy = **xoá hết dấu đã xây** của sơ đồ đang xem (người dùng 2026-10-12, lần 3); có dấu nào thì hỏi lại trước
            const o = opened();
            if (o && (Object.values(o.doc.built ?? {}).some((v) => v > 0) || o.doc.checks?.length)) {
              const ok = await confirmDialog(tr('Bỏ hết các máy đã đánh dấu xây trong "{0}"?', o.title), tr('Bỏ hết'));
              if (!ok) return;
              o.doc.built = {};
              delete o.doc.checks;
              o.save();
            }
            source = null;
            drawBar();
            refresh();
          },
        }, tr('Hủy')),
      );
  };
  let smallList: HTMLElement | null = null;
  /** Bề rộng nội dung danh sách (bảng nhỏ co vừa nó); 0 = chưa đo (danh sách sơ đồ bên Map ⇒ rộng tối đa). */
  let contentW = 0;
  const maxPanelW = (left = parseFloat(panel.style.left) || 70): number => Math.min(476, innerWidth - left - 8);
  const drawBody = (): void => {
    const o = opened();
    if (o) {
      if (!smallList || !body.contains(smallList)) {
        clear(body);
        const ico = el('span', { class: 'cl-body-ico' });
        ico.innerHTML = CHECK_ICON;
        smallList = el('div', { class: 'cl-list' });
        body.append(el('div', { class: 'cl-body-title' }, ico, el('span', {}, o.title)), smallList);
      }
      const top = body.scrollTop;
      // cỡ icon tính theo bề rộng **tối đa** của bảng (không theo bề rộng đã co ⇒ không co mãi), rồi bảng co vừa nội dung
      fillList(smallList, o, maxPanelW() - (touch() ? 12 : 20), 1, false);
      // + lề trong của thân bảng + thanh cuộn dọc (nếu có) + viền
      contentW = Math.ceil(smallList.scrollWidth) + (touch() ? 12 : 20) + (body.offsetWidth - body.clientWidth) + 2;
      body.scrollTop = top;
      return;
    }
    smallList = null;
    contentW = 0; // danh sách sơ đồ: rộng tối đa
    clear(body);
    if (modeler()) {
      body.append(el('div', { class: 'cl-empty' }, tr('Sơ đồ Modeler này chưa có máy nào.')));
      return;
    }
    // bên Map: chọn sơ đồ
    const src = sources();
    const item = (s: Source, name: string, icon: string | null, kind: string): HTMLElement => {
      const b = el(
        'button',
        { class: 'cl-src', type: 'button' },
        icon ? el('img', { src: itemIconSrc(state, icon), alt: '' }) : el('span', { class: 'cl-src-ico' }, kind),
        el('span', { class: 'cl-src-name' }, name),
      );
      b.addEventListener('click', () => {
        source = s;
        unfolded.clear();
        drawBar();
        refresh();
      });
      return b;
    };
    body.append(el('div', { class: 'cl-sec' }, tabs.active.group ? tr('Tab Modeler cùng nhóm') : tr('Tab Modeler đang mở')));
    if (src.tabs.length === 0) body.append(el('div', { class: 'cl-empty small' }, tr('Không có tab Modeler nào')));
    for (const t of src.tabs) body.append(item({ kind: 'tab', id: t.id }, t.title, null, '⊞'));
    body.append(el('div', { class: 'cl-sec' }, tr('Đã lưu trong Thư viện')));
    if (src.lib.length === 0) body.append(el('div', { class: 'cl-empty small' }, tr('Chưa lưu sơ đồ Modeler nào')));
    for (const b of src.lib) body.append(item({ kind: 'lib', id: b.id }, b.name, b.icon, '▦'));
  };
  const refresh = (): void => {
    if (mode === 'open') drawBody();
    if (bigOpen) fillBig();
    if (subsOpen) {
      const o = opened();
      if (o) drawSubs(o);
      else closeSubs();
    }
    // hiệu ứng tích / xong chỉ chạy ở lần vẽ ngay sau thao tác
    fx.tick.clear();
    fx.done.clear();
  };
  /**
   * Ẩn ⇄ Mở — **như thanh điều khiển mô phỏng** (người dùng 2026-10-26): bảng phóng ra từ **tâm nút** checklist (co giãn
   * đều, mờ → rõ, hơi nảy) và thu nhỏ dần vào tâm nút ẩn rồi biến mất. Trước đó bảng co méo về góc dưới trái thành một ô
   * 38 px ⇒ trông như đóng mở ở góc màn hình chứ không phải từ nút.
   */
  const originAt = (r: DOMRect, p: DOMRect): string => `${r.left + r.width / 2 - p.left}px ${r.top + r.height / 2 - p.top}px`;
  const setMode = (m: 'hidden' | 'open'): void => {
    if (m === mode) return;
    mode = m;
    if (m === 'open') {
      // điện thoại dọc: bảng chọn máy đang mở chiếm nửa màn ⇒ thu lại (mỗi lúc một bảng, như các bảng khác)
      if (portrait() && !app.classList.contains('palette-collapsed') && !app.classList.contains('palette-hidden')) window.dispatchEvent(new Event('efp:toggle-palette'));
      place();
      const f = fab.getBoundingClientRect(); // đo **trước** khi ẩn nút
      panel.hidden = false;
      fab.hidden = true;
      smallList = null;
      drawBar();
      drawBody();
      const p = panel.getBoundingClientRect();
      if (motion() && p.width > 0 && f.width > 0) {
        panel.style.transformOrigin = originAt(f, p);
        panel.animate([{ transform: 'scale(0.04)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1.05)' });
      }
      return;
    }
    const p = panel.getBoundingClientRect();
    const end = (): void => {
      if (mode !== 'hidden' || panel.hidden) return;
      panel.hidden = true;
      fab.hidden = false;
    };
    const hide = panel.querySelector('.cl-hide');
    const h = hide?.getBoundingClientRect();
    if (!motion() || p.width === 0 || !h || h.width === 0) return end();
    panel.style.transformOrigin = originAt(h, p);
    const an = panel.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.04)', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
    an.onfinish = () => {
      end();
      an.cancel();
    };
    setTimeout(() => {
      end();
      an.cancel();
    }, 320);
  };
  fab.addEventListener('click', () => setMode('open'));

  // ------------------------------------------------------------------ vị trí
  const shownRect = (e: Element | null): DOMRect | null => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && getComputedStyle(e).display !== 'none' ? r : null;
  };
  /**
   * Góc dưới trái khung bản vẽ (sau bảng chọn máy); có thanh mô phỏng / nút con mắt ⇒ ngay trên nó. Đổi chỗ trượt mượt
   * (CSS `transition`) ⇒ thanh mô phỏng hiện ra / thu lại thì nút / bảng checklist bị đẩy theo.
   */
  const place = (): void => {
    const board = shownRect(modeler() ? document.querySelector('.md-viewport') : document.querySelector('canvas.board'));
    if (!board) {
      fab.style.visibility = 'hidden';
      panel.style.visibility = 'hidden';
      return;
    }
    fab.style.visibility = panel.style.visibility = '';
    const pal = shownRect(document.querySelector('.panel.left'));
    let left = Math.max(board.left, pal && pal.left < board.left + board.width / 2 ? pal.right : board.left) + 12;
    let bottom = innerHeight - Math.min(board.bottom, innerHeight) + 14;
    const sim = app.classList.contains('sim-mode') && !modeler();
    const above = sim ? (shownRect(document.querySelector('.sim-bar')) ?? shownRect(document.querySelector('.sim-eye.floating'))) : null;
    if (above) {
      bottom = innerHeight - above.top + 8;
      left = Math.max(left, above.left);
    }
    const set = (e: HTMLElement, k: string, v: number): void => {
      const s = `${Math.round(v)}px`;
      if (e.style.getPropertyValue(k) !== s) e.style.setProperty(k, s);
    };
    set(fab, 'left', left);
    set(fab, 'bottom', bottom);
    const w = Math.min(maxPanelW(left), contentW || 476);
    const h = Math.max(180, Math.min(touch() ? 520 : 460, innerHeight - bottom - 64));
    set(panel, 'left', left);
    set(panel, 'bottom', bottom);
    set(panel, 'width', w);
    set(panel, 'height', h);
  };
  let wasModeler = modeler();
  const tick = (): void => {
    place();
    // đổi Map ⇄ Modeler ⇒ vẽ lại nội dung
    const m = modeler();
    if (m !== wasModeler) {
      wasModeler = m;
      unfolded.clear();
      smallList = null;
      if (mode === 'open') drawBar();
      refresh();
    }
  };
  /**
   * Đi theo bố cục **khi có thay đổi** thay vì đo liên tục mỗi 50 ms suốt đời app (rà soát 2026-10-14 — tốn pin điện
   * thoại khi không ai thao tác). Đo lại khi: khung bản vẽ / bảng chọn máy / thanh mô phỏng / nút con mắt đổi cỡ
   * (`ResizeObserver` — gồm cả lúc chúng co giãn có animation), `#app` đổi lớp (vào / ra mô phỏng, Modeler, thu bảng…),
   * thanh mô phỏng / nút con mắt / khung Modeler xuất hiện hay biến mất, hoặc một animation / transition chạy trên
   * các phần đó. Mỗi lần có tín hiệu: đo theo từng khung hình thêm 450 ms (đủ hết animation) rồi nghỉ.
   */
  let pumping = false;
  let until = 0;
  // trang đang ẩn thì `requestAnimationFrame` không chạy ⇒ dùng hẹn giờ
  const nextFrame = (f: () => void): void => void (document.hidden ? setTimeout(f, 50) : requestAnimationFrame(f));
  const pump = (): void => {
    tick();
    if (performance.now() < until) nextFrame(pump);
    else pumping = false;
  };
  const follow = (ms = 450): void => {
    until = Math.max(until, performance.now() + ms);
    if (pumping) return;
    pumping = true;
    pump(); // đo ngay lần đầu, rồi theo từng khung hình
  };
  document.addEventListener('visibilitychange', () => follow());
  const WATCH = 'canvas.board, .panel.left, .sim-bar, .sim-eye, .md-viewport';
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => follow()) : null;
  const watched = new WeakSet<Element>();
  const watchAll = (): void => {
    for (const e of document.querySelectorAll(WATCH))
      if (!watched.has(e)) {
        watched.add(e);
        ro?.observe(e);
      }
  };
  const touches = (nodes: NodeList): boolean => {
    for (const n of nodes) if (n instanceof Element && (n.matches(WATCH) || n.querySelector(WATCH))) return true;
    return false;
  };
  // lớp của **chính `#app`** (vào / ra mô phỏng, Modeler, thu bảng…) — không theo dõi lớp của phần tử con: khi zoom / rê
  // chuột các nút, ô… đổi lớp liên tục ⇒ checklist đo bố cục mỗi khung hình, chen vào lúc vẽ bản đồ (giật khi zoom —
  // người dùng báo 2026-10-14, đo trên Firefox: khung > 50 ms tăng từ 1–7 lên 17–20 mỗi lượt khi checklist mở)
  new MutationObserver(() => {
    watchAll();
    follow();
  }).observe(app, { attributes: true, attributeFilter: ['class'] });
  // phần tử cần theo dõi (thanh mô phỏng, nút con mắt, khung Modeler…) xuất hiện / biến mất
  new MutationObserver((records) => {
    for (const r of records)
      if (touches(r.addedNodes) || touches(r.removedNodes)) {
        watchAll();
        follow();
        return;
      }
  }).observe(app, { childList: true, subtree: true });
  const onAnim = (e: Event): void => {
    const t = e.target as Element | null;
    if (t === app || t?.closest?.(WATCH)) follow(700);
  };
  for (const t of ['transitionrun', 'animationstart'] as const) document.addEventListener(t, onAnim, true);
  watchAll();
  follow(1500); // giao diện đang dựng lúc khởi động
  window.addEventListener('resize', () => {
    place();
    refresh();
  });
  // sơ đồ Modeler đang mở vừa đổi / chuyển tab (`main.ts`) ⇒ cập nhật checklist
  window.addEventListener(CHECKLIST_REFRESH, () => {
    smallList = null;
    if (mode === 'open') drawBar();
    refresh();
  });
  window.addEventListener(LIBRARY_EVENT, () => {
    if (mode === 'open' && !source) refresh();
  });
  /**
   * **Shift** (trước 2026-10-26 là Ctrl — trùng nhiều tổ hợp quá) mở / đóng checklist (người dùng 2026-10-13) — hai cách cùng lúc: bấm nhả nhanh ⇒ bật / tắt; giữ quá 0,3 s ⇒
   * mở trong lúc giữ, nhả ra thì đóng (vẫn bấm chuột vào bảng được khi đang giữ). Đang giữ Ctrl mà bấm phím khác (Ctrl+Z…)
   * ⇒ checklist bỏ qua lần này tới khi nhả Ctrl (mở do giữ thì đóng lại).
   */
  let ctrl: { other: boolean; held: boolean; wasOpen: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  const ctrlOff = (): void => {
    if (ctrl) clearTimeout(ctrl.timer);
    ctrl = null;
  };
  window.addEventListener('keydown', (e) => {
    // `keyMatches` (không phải `matchesKey`): Shift bấm khi đang giữ Ctrl / Alt (Ctrl+Shift+Z…) không phải checklist
    if (matchesKey('checklist', hotkeyOf(e)) && (ctrl || keyMatches('checklist', e))) {
      if (e.repeat || ctrl) return;
      if (document.body.classList.contains('modal-open') || fab.style.visibility === 'hidden') return;
      // mở **ngay** khi bấm (người dùng 2026-10-13), nhả ra mới quyết định có đóng không
      const c = { other: false, held: false, wasOpen: mode === 'open', timer: 0 as unknown as ReturnType<typeof setTimeout> };
      c.timer = setTimeout(() => {
        if (ctrl === c && !c.other) c.held = true;
      }, 300);
      ctrl = c;
      if (mode !== 'open') setMode('open');
      return;
    }
    if (ctrl && !ctrl.other) {
      ctrl.other = true;
      clearTimeout(ctrl.timer);
      if (!ctrl.wasOpen) setMode('hidden');
    }
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!ctrl || !matchesKey('checklist', hotkeyOf(e))) return;
    const c = ctrl;
    ctrlOff();
    if (c.other) return;
    // giữ lâu ⇒ đóng lại nếu trước đó đang đóng; bấm nhanh ⇒ bật / tắt (đã mở sẵn lúc bấm, nên chỉ đóng nếu trước đó mở)
    if (c.held ? !c.wasOpen : c.wasOpen) setMode('hidden');
  }, true);
  window.addEventListener('blur', ctrlOff);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (subsOpen) closeSubs();
    else if (bigOpen) closeBig();
    else return;
    e.stopPropagation();
  }, true);
  place();
}

/** `main.ts` phát khi sơ đồ Modeler đang mở đổi / chuyển tab ⇒ checklist vẽ lại. */
export const CHECKLIST_REFRESH = 'efp:checklist-refresh';
