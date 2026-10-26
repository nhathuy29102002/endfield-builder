import type { AppState, Tool } from '../editor/state';
import type { Renderer } from '../render/renderer';
import { failNote, type CommitResult, type InputHandle } from '../editor/input';
import { boxSelection, selectionBounds, unionSelection, tileKeyOf } from '../editor/group';
import { machineAt } from '../editor/ops';
import { deleteSelected, enterTool, startGroup } from '../editor/tools';
import { BeltPath } from '../editor/beltPath';
import { commitPlan } from '../editor/belts';
import { beltAt } from '../model/network';
import { footprint } from '../model/geometry';
import type { Cell } from '../model/types';
import { pressKey, touchModes } from './touch';
import { showHoldRing, type HoldRing } from './holdRing';
import { tr } from '../i18n';

/**
 * **Điều khiển cảm ứng của Map** — cơ chế quản lý máy riêng cho điện thoại (người dùng 2026-10-05, lần 2):
 *
 * - Một ngón rê = kéo bản đồ, hai ngón = kéo + chụm/mở để zoom (mọi lúc).
 * - **Đặt máy mới**: chọn máy ở bảng chọn máy (máy đó được tô sáng), **chạm vào bản đồ ⇒ đặt preview** (chưa đặt máy);
 *   rê từ preview = dời preview; chạm chỗ khác = preview nhảy tới đó. Thanh thao tác bên phải: **Đặt / Xoay / Huỷ**;
 *   máy có chế độ ⇒ thanh chọn chế độ ở trên cùng (`touchActions.ts`).
 * - **Chọn**: chạm máy / ô băng = chọn (nút "Chọn thêm" bật ⇒ thêm vào vùng chọn); giữ 0,5 s ở ô trống ⇒ khoanh vùng
 *   (hoặc nút "Chọn vùng"). Đang chọn ⇒ thanh bên phải thành thanh thao tác máy.
 * - **Giữ tay trên một máy bất kỳ / nhóm đang chọn ⇒ vòng đếm 0,5 s tại điểm chạm** (`holdRing.ts`, 2026-10-11), đầy
 *   thì nhấc lên, **rê theo ngón tay, nhấc tay là đặt luôn** và chọn chỗ mới; thả vào chỗ vướng / ngón khác chạm bản đồ
 *   ⇒ huỷ, về chỗ cũ. Rê ra khỏi vòng trước khi đầy ⇒ kéo bản đồ. Giữ 0,5 s ở ô trống ⇒ khoanh vùng.
 * - **Đặt băng / ống**: ngón tay vẽ đường (`editor/beltPath.ts`), cả phiên được xem trước (kể cả cầu); chỉ Đặt / Huỷ.
 *   Đặt ngón vào đầu ống (hoặc ô kề) ⇒ vẽ tiếp; chưa có đường ⇒ chạm đâu bắt đầu ở đó; có đường rồi mà chạm chỗ khác
 *   ⇒ kéo bản đồ.
 */

const SLOP = 10;
const HOLD_MS = 500;

/** Trạng thái dùng chung với thanh thao tác. */
export interface MapTouch {
  /** Đường băng / ống đang vẽ (công cụ `link`). */
  path: BeltPath | null;
  /** Đặt thứ đang cầm; trả về kết quả (đặt được không, lý do) — xem `CommitResult`. */
  commit(): CommitResult;
  cancel(): void;
  rotate(): void;
  copy(): void;
  move(): void;
  remove(): void;
  /** Cầm một công trình (van gộp / tách, cảng kiểm soát, cầu nối…) để đặt như chọn ở bảng chọn máy. */
  placeMachine(machineId: string): void;
  /** Đang có preview đặt được (máy mới / nhóm / bản vẽ) hoặc đường ống đặt được. */
  canCommit(): boolean;
  /** Ngón tay đang rê preview (máy / nhóm đang nhấc, hoặc preview đang kéo). */
  dragging(): boolean;
  /** Ngón tay đang rê máy / nhóm nhấc lên bằng **giữ tay** — nhấc tay là đặt luôn. */
  holdDragging(): boolean;
  /** Khung preview trên màn hình (px trong canvas) + đặt được không — xem `Renderer.previewBox`. */
  previewBox(): Renderer['previewBox'];
  /** Gọi `fn` sau mỗi lần vẽ bản đồ. */
  onDrawn(fn: () => void): void;
}

const vibrate = (ms: number): void => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* không rung được thì thôi */
  }
};

interface Pt {
  x: number;
  y: number;
}

export function attachMapTouch(canvas: HTMLCanvasElement, state: AppState, renderer: Renderer, input: InputHandle): MapTouch {
  canvas.style.touchAction = 'none';
  type Mode = 'wait' | 'pan' | 'box' | 'preview' | 'draw' | 'forward' | 'done';
  let g: {
    id: number;
    start: Pt;
    last: Pt;
    mode: Mode;
    timer: ReturnType<typeof setTimeout> | null;
    startCell: Cell;
    base: Cell | null;
    /** đang dời nhóm do **giữ tay** trên máy đang chọn — nhấc tay là đặt luôn */
    fromHold?: boolean;
    /** vòng đếm giữ tay trên máy / nhóm đang chọn (người dùng 2026-10-11) */
    ring?: HoldRing | null;
  } | null = null;
  let pinch: { c: Pt; d: number } | null = null;
  let lastReason = '';

  const local = (p: Pt): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  };
  const cellAt = (p: Pt): Cell => {
    const l = local(p);
    return renderer.camera.toCell(l.x, l.y);
  };
  const mouse = (type: string, p: Pt, ctrl = false): void =>
    void canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: p.x, clientY: p.y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ctrlKey: ctrl }));

  /** Công cụ đang cầm thứ gì đó có preview (máy mới / di chuyển / sao chép, nhóm, bản vẽ). */
  const previewTool = (): boolean => {
    const t = state.tool;
    return t.kind === 'place' || t.kind === 'stamp' || t.kind === 'group';
  };
  /** Ô "con trỏ" hiện tại của preview (ô tâm), hoặc `null` khi chưa đặt preview. */
  const previewCell = (): Cell | null => {
    const t = state.tool;
    if (t.kind === 'group' || t.kind === 'stamp') return renderer.groupTarget;
    return renderer.ghost ? renderer.hover.cell : null;
  };
  /** Ngón tay đặt lên preview (để kéo preview đi thay vì kéo bản đồ). */
  const onPreview = (c: Cell): boolean => {
    const t = state.tool;
    const at = previewCell();
    if (!at) return false;
    let half = 1.5;
    if (t.kind === 'place' && renderer.ghost) {
      const def = state.ds.machines.get(t.machineId);
      if (def) {
        const f = footprint(def, t.rot);
        const g0 = renderer.ghost;
        return c.x >= g0.x - 1 && c.x <= g0.x + f.w && c.z >= g0.z - 1 && c.z <= g0.z + f.d;
      }
    } else if (t.kind === 'group') {
      const b = selectionBounds(state.bp, state.ds, state.sel);
      if (b) half = Math.max(b.x1 - b.x0 + 1, b.z1 - b.z0 + 1) / 2 + 1;
    } else half = 3;
    return Math.abs(c.x - at.x) <= half && Math.abs(c.z - at.z) <= half;
  };

  // ---- vẽ băng / ống
  const showPath = (): void => {
    const p = api.path;
    renderer.preview = p?.plan() ?? null;
    renderer.pathHead = p?.head ?? null;
    if (p && p.reason !== lastReason) {
      lastReason = p.reason;
      if (p.reason) state.notify(p.reason);
    }
    state.emit('view');
  };
  const pathKind = (): 'belt' | 'pipe' | null => (state.tool.kind === 'link' ? state.tool.linkKind : null);

  // đổi công cụ: bỏ đường đang vẽ / ẩn preview máy vừa chọn ở bảng chọn máy (chưa chạm bản đồ thì chưa có preview)
  let lastTool = state.tool;
  state.subscribe(() => {
    const t = state.tool;
    if (t === lastTool) return;
    const prev = lastTool;
    lastTool = t;
    if (t.kind !== 'link' || (prev.kind === 'link' && prev.linkKind !== t.linkKind)) {
      if (api.path) {
        api.path = null;
        renderer.pathHead = null;
      }
    }
    if (t.kind === 'place' && (t.mode ?? 'new') === 'new' && !(prev.kind === 'place' && prev.machineId === t.machineId)) input.pointAt(null);
  });

  /** Công cụ hiện tại (đọc lại sau khi gọi hàm đổi công cụ — tránh TypeScript giữ kiểu cũ đã thu hẹp). */
  const toolNow = (): Tool => state.tool;

  const api: MapTouch = {
    path: null,
    dragging: () => g?.mode === 'preview',
    previewBox: () => renderer.previewBox,
    onDrawn: (fn) => void renderer.afterDraw.add(fn),
    holdDragging: () => g?.mode === 'preview' && !!g.fromHold,
    canCommit() {
      const t = state.tool;
      if (t.kind === 'link') return !!api.path?.plan()?.ok;
      if (t.kind === 'place') return !!renderer.ghost;
      if (t.kind === 'group' || t.kind === 'stamp') return !!renderer.groupTarget;
      return false;
    },
    commit(): CommitResult {
      const t = state.tool;
      if (t.kind === 'link') {
        const plan = api.path?.plan();
        if (!plan?.ok) return { ok: false };
        state.mutate(t.linkKind === 'pipe' ? tr('Đặt ống') : tr('Đặt băng chuyền'), () => {
          commitPlan(state.bp, plan);
          state.message = plan.endsAtPort
            ? tr('Đã nối {0} vào máy', t.linkKind === 'pipe' ? tr('ống') : tr('băng chuyền'))
            : tr('Đã đặt {0} ô — vẽ tiếp, hoặc Huỷ để thôi', plan.cells.length);
        });
        api.path = null;
        renderer.preview = null;
        renderer.pathHead = null;
        state.emit('view');
        return { ok: true };
      }
      const wasCopy = t.kind === 'group' && t.mode === 'copy';
      const wasMove = t.kind === 'group' && t.mode === 'move';
      const wasNew = t.kind === 'place' && (t.mode ?? 'new') === 'new';
      const keep = touchModes.keep;
      const r = input.commitHere();
      if (!r.ok) return r;
      if (wasNew) {
        // "Đặt tiếp" bật: ẩn preview, vẫn cầm máy đó; tắt: đặt **một** máy rồi thoát chế độ đặt (người dùng 2026-10-06)
        if (keep) input.pointAt(null);
        else enterTool(state, renderer, { kind: 'select' });
      } else if (keep && (wasCopy || t.kind === 'stamp')) {
        // đặt tiếp bản sao / bản vẽ: preview mới ngay cạnh bản vừa đặt
        if (wasCopy && r.sel) {
          enterTool(state, renderer, { kind: 'select' });
          state.setSelection(r.sel);
          api.copy();
        }
      } else if (keep && wasMove && r.sel) {
        // dời xong mà "Đặt tiếp" đang bật ⇒ cầm bản sao của nhóm vừa dời để đặt thêm
        state.setSelection(r.sel);
        api.copy();
      } else if (wasCopy || t.kind === 'stamp') {
        // sao chép / bản vẽ: đặt một bản rồi về chọn — chọn luôn bản vừa đặt
        enterTool(state, renderer, { kind: 'select' });
        state.message = wasCopy ? tr('Đã đặt bản sao — bản sao đang được chọn') : tr('Đã đặt bản vẽ');
        if (r.sel) state.setSelection(r.sel);
        else state.emit('ui');
      }
      return r;
    },
    cancel() {
      if (state.tool.kind === 'link') {
        api.path = null;
        renderer.preview = null;
        renderer.pathHead = null;
      }
      if (touchModes.box || touchModes.add || touchModes.keep) {
        touchModes.box = touchModes.add = touchModes.keep = false;
        touchModes.changed();
      }
      pressKey('Escape', 'Escape');
    },
    rotate() {
      pressKey('KeyR', 'r');
    },
    move() {
      if (state.tool.kind !== 'select') return;
      startGroup(state, renderer, 'move');
      const t = toolNow();
      if (t.kind === 'group') input.pointAt(t.anchor);
    },
    copy() {
      if (state.tool.kind !== 'select') return;
      // sao chép **sang ô ngay cạnh** (bên phải trên màn hình) rồi cho dời bản sao đi (người dùng 2026-10-05)
      const b = selectionBounds(state.bp, state.ds, state.sel);
      startGroup(state, renderer, 'copy');
      const t = toolNow();
      if (t.kind !== 'group' || !b) return;
      const v = renderer.camera.screenVec(1, 0);
      const w = b.x1 - b.x0 + 1;
      const d = b.z1 - b.z0 + 1;
      input.pointAt({ x: t.anchor.x + Math.round(v.x) * w, z: t.anchor.z + Math.round(v.y) * d });
      state.notify(tr('Bản sao ở ngay bên cạnh — rê để dời, Đặt để đặt'));
    },
    remove() {
      deleteSelected(state, renderer);
    },
    placeMachine(machineId) {
      api.path = null;
      renderer.preview = null;
      renderer.pathHead = null;
      enterTool(state, renderer, { kind: 'place', machineId, rot: 0, mode: 'new' });
      input.pointAt(null);
    },
  };

  const clearTimer = (): void => {
    if (g?.timer) clearTimeout(g.timer);
    g?.ring?.remove();
    if (g) {
      g.timer = null;
      g.ring = null;
    }
  };
  const endBox = (commit: boolean): void => {
    const box = renderer.box;
    renderer.box = null;
    if (commit && box) {
      const picked = boxSelection(state.bp, state.ds, box.a, box.b);
      state.setSelection(touchModes.add ? unionSelection(state.sel, picked) : picked);
    }
    if (touchModes.box) {
      touchModes.box = false;
      touchModes.changed();
    }
    state.emit('view');
  };
  /**
   * Ô có thứ nhấc lên được bằng **giữ tay** (vòng đếm 0,5 s — người dùng 2026-10-11): một máy bất kỳ, hoặc ô băng / ống
   * thuộc vùng đang chọn. Luật đổi: trước đây giữ trên máy **chưa chọn** là khoanh vùng (2026-10-05, lần 3).
   */
  const liftable = (c: Cell): boolean => {
    const m = machineAt(state.bp, state.ds, c);
    if (m) return !m.fixed;
    return (['belt', 'pipe'] as const).some((k) => beltAt(state.bp, k, c) && state.sel.tiles.has(tileKeyOf({ kind: k, x: c.x, z: c.z })));
  };
  /** Vòng đếm đầy: nhấc máy (chưa chọn ⇒ chọn riêng nó; đang chọn ⇒ cả nhóm) hoặc cả vùng chọn để dời theo ngón tay. */
  const holdToMove = (c: Cell): boolean => {
    if (!liftable(c)) return false;
    const m = machineAt(state.bp, state.ds, c);
    if (m && !state.sel.machines.has(m.uid)) state.select(m.uid);
    const b = selectionBounds(state.bp, state.ds, state.sel);
    if (!b) return false;
    startGroup(state, renderer, 'move', c);
    // cầm đúng ô dưới ngón tay: preview nằm yên dưới tay, rê là dời theo
    const t = state.tool;
    if (t.kind === 'group') state.setTool({ ...t, drag: false });
    input.pointAt(c);
    return true;
  };

  /**
   * Tự cuộn sát mép (người dùng 2026-10-26): ngón tay đang rê preview / khung chọn ở `p` ⇒ báo `input.ts`; bản đồ trôi
   * dưới ngón tay đứng yên thì preview / khung bám theo ô mới dưới ngón tay.
   */
  const follow = (p: Pt | null): void => {
    if (!p) return input.edgeFollow(null);
    input.edgeFollow({
      x: p.x,
      y: p.y,
      after: () => {
        if (!g) return input.edgeFollow(null);
        const c = cellAt(p);
        if (g.mode === 'preview' && g.base) input.pointAt({ x: g.base.x + c.x - g.startCell.x, z: g.base.z + c.z - g.startCell.z });
        else if (g.mode === 'box' && renderer.box) {
          renderer.box = { a: renderer.box.a, b: c };
          state.emit('view');
        }
      },
    });
  };

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      const ts = e.touches;
      if (ts.length >= 2) {
        if (g && g.mode === 'forward') return;
        follow(null);
        if (g) {
          clearTimer();
          if (g.mode === 'box') endBox(false);
          // đang rê máy / nhóm nhấc bằng giữ tay mà ngón khác chạm bản đồ ⇒ huỷ, về chỗ cũ (người dùng 2026-10-11)
          if (g.mode === 'preview' && g.fromHold && state.tool.kind === 'group') {
            pressKey('Escape', 'Escape');
            state.notify(tr('Đã huỷ di chuyển — về chỗ cũ'));
          }
          g.mode = 'done';
        }
        pinch = { c: { x: (ts[0]!.clientX + ts[1]!.clientX) / 2, y: (ts[0]!.clientY + ts[1]!.clientY) / 2 }, d: Math.hypot(ts[0]!.clientX - ts[1]!.clientX, ts[0]!.clientY - ts[1]!.clientY) || 1 };
        return;
      }
      const t = e.changedTouches[0]!;
      const p = { x: t.clientX, y: t.clientY };
      const c = cellAt(p);
      g = { id: t.identifier, start: p, last: p, mode: 'wait', timer: null, startCell: c, base: null };
      const kind = state.tool.kind;
      const pk = pathKind();
      if (pk) {
        // vẽ băng / ống: đặt ngón ở đầu ống (hoặc ô kề) ⇒ vẽ tiếp; chưa có đường ⇒ bắt đầu ở đây
        if (api.path && !api.path.empty) {
          const h = api.path.head!;
          if (Math.abs(h.x - c.x) + Math.abs(h.z - c.z) <= 1) {
            api.path.begin(c);
            g.mode = 'draw';
            showPath();
          }
          return; // chạm chỗ khác: đợi xem là kéo bản đồ
        }
        const path = api.path ?? new BeltPath(state.bp, state.ds, pk);
        if (path.begin(c)) {
          api.path = path;
          g.mode = 'draw';
        } else state.notify(path.reason);
        showPath();
        return;
      }
      if (previewTool()) {
        if (onPreview(c)) g.base = previewCell();
        return;
      }
      if (kind === 'terrain') {
        g.mode = 'forward';
        mouse('mousemove', p);
        mouse('mousedown', p);
        return;
      }
      if (kind === 'select' && touchModes.box) {
        g.mode = 'box';
        renderer.box = { a: c, b: c };
        state.emit('view');
        return;
      }
      if (kind === 'select' && liftable(c)) {
        // giữ tay trên máy / nhóm đang chọn: vòng đếm tại điểm chạm, đầy (0,5 s) ⇒ nhấc lên (người dùng 2026-10-11)
        g.ring = showHoldRing(p.x, p.y, true, () => {
          if (!g || g.mode !== 'wait') return;
          g.ring = null;
          vibrate(25);
          if (holdToMove(g.startCell)) {
            g.mode = 'preview';
            g.base = g.startCell;
            g.fromHold = true;
            state.emit('view');
          }
        });
      } else if (kind === 'select')
        g.timer = setTimeout(() => {
          if (!g || g.mode !== 'wait') return;
          g.timer = null;
          vibrate(25);
          g.mode = 'box';
          renderer.box = { a: g.startCell, b: g.startCell };
          state.emit('view');
        }, HOLD_MS);
    },
    { passive: false },
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      const ts = e.touches;
      if (pinch && ts.length >= 2) {
        const c = { x: (ts[0]!.clientX + ts[1]!.clientX) / 2, y: (ts[0]!.clientY + ts[1]!.clientY) / 2 };
        const d = Math.hypot(ts[0]!.clientX - ts[1]!.clientX, ts[0]!.clientY - ts[1]!.clientY) || 1;
        renderer.camera.pan(c.x - pinch.c.x, c.y - pinch.c.y);
        const l = local(c);
        renderer.camera.zoomAt(l.x, l.y, d / pinch.d);
        pinch = { c, d };
        state.emit('view');
        return;
      }
      if (!g) return;
      const t = [...e.changedTouches].find((x) => x.identifier === g!.id);
      if (!t) return;
      const p = { x: t.clientX, y: t.clientY };
      const c = cellAt(p);
      if (g.mode === 'wait') {
        // còn vòng đếm: rê trong vòng thì vẫn đếm; ra ngoài vòng ⇒ huỷ vòng, thành kéo bản đồ
        if (g.ring ? g.ring.inside(p.x, p.y) : Math.hypot(p.x - g.start.x, p.y - g.start.y) < SLOP) return;
        clearTimer();
        g.mode = g.base ? 'preview' : 'pan';
        if (g.mode === 'pan') {
          renderer.camera.pan(p.x - g.start.x, p.y - g.start.y);
          state.emit('view');
          g.last = p;
          return;
        }
      }
      switch (g.mode) {
        case 'pan':
          renderer.camera.pan(p.x - g.last.x, p.y - g.last.y);
          state.emit('view');
          break;
        case 'preview':
          // dời preview theo ngón tay (giữ nguyên chỗ đã nắm trên preview)
          if (g.base) input.pointAt({ x: g.base.x + c.x - g.startCell.x, z: g.base.z + c.z - g.startCell.z });
          break;
        case 'draw':
          api.path?.moveTo(c);
          showPath();
          break;
        case 'box':
          if (renderer.box) renderer.box = { a: renderer.box.a, b: c };
          state.emit('view');
          break;
        case 'forward':
          mouse('mousemove', p);
          break;
      }
      follow(g.mode === 'preview' || g.mode === 'box' ? p : null);
      g.last = p;
    },
    { passive: false },
  );

  const end = (e: TouchEvent, cancel: boolean): void => {
    e.preventDefault();
    if (pinch) {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) g = null;
      return;
    }
    if (!g) return;
    const t = [...e.changedTouches].find((x) => x.identifier === g!.id);
    if (!t) return;
    const p = { x: t.clientX, y: t.clientY };
    clearTimer();
    follow(null);
    const mode = g.mode;
    const fromHold = g.fromHold;
    g = null;
    state.emit('view'); // nút nổi Đặt / Xoay / Huỷ: hết rê ⇒ vẽ lại chỗ của chúng
    if (mode === 'box') return endBox(!cancel);
    // giữ tay rồi rê máy / nhóm: nhấc tay ⇒ **đặt luôn** và chọn chỗ mới (người dùng 2026-10-05). Luật đổi 2026-10-11:
    // thả vào chỗ vướng (hoặc chạm bị huỷ) ⇒ **huỷ, máy / nhóm về chỗ cũ** (trước đây vẫn ở chế độ di chuyển)
    if (mode === 'preview' && fromHold && state.tool.kind === 'group') {
      const res = cancel ? null : api.commit();
      if (toolNow().kind === 'group') {
        const why = failNote(res?.reason);
        pressKey('Escape', 'Escape');
        state.notify(tr('{0}đã trả về chỗ cũ', why));
      }
      return;
    }
    if (mode === 'forward') {
      mouse('mousemove', p);
      mouse('mouseup', p);
      return;
    }
    if (mode !== 'wait' || cancel) return;
    // chạm nhanh
    if (previewTool()) {
      input.pointAt(cellAt(p)); // preview nhảy tới chỗ chạm (chưa đặt)
      return;
    }
    if (pathKind()) return;
    // đang chọn đúng một máy mà chạm lại vào chính nó ⇒ bỏ chọn (người dùng 2026-10-05: khỏi phải bấm Huỷ)
    if (state.tool.kind === 'select' && !touchModes.add && state.selection !== null) {
      const hit = machineAt(state.bp, state.ds, cellAt(p));
      if (hit && hit.uid === state.selection) {
        state.select(null);
        return;
      }
    }
    mouse('mousemove', p);
    mouse('mousedown', p, touchModes.add);
    mouse('mouseup', p, touchModes.add);
  };
  canvas.addEventListener('touchend', (e) => end(e, false), { passive: false });
  canvas.addEventListener('touchcancel', (e) => end(e, true), { passive: false });
  return api;
}
