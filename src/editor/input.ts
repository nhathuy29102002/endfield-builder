import {
  addMachine,
  copyMachine,
  cycleMode,
  inlineRotations,
  machineAt,
  moveMachine,
  pairCandidates,
  removeMachine,
  rotateMachine,
  setMode,
  setPairTarget,
} from './ops';
import { BACKSPACE_HOLD_MS, hotkeyOf, INJECTED_HOLD_MS, isInjected } from './keys';
import { pinnedMachineIds } from '../ui/palette';
import { originFor, rotFromDrag } from './placement';
import { bridgeExit, commitPlan, planBelt, removeBeltAt, specAt, type StartSpec } from './belts';
import {
  copyToClipboard,
  deleteSelected,
  dropGroup,
  dropStamp,
  enterTool,
  PALETTE_DROP_EVENT,
  pasteClipboard,
  rotateSelection,
  startCopy,
  startGroup,
  startMove,
  toggleLabels,
  toggleLayer,
  toggleOffSelected,
} from './tools';
import { boxSelection, clickTile, emptySelection, selectionSize, subtractSelection, toggleMachine, unionSelection } from './group';
import { beltAt } from '../model/network';
import type { AppState, Tool } from './state';
import type { Selection } from './group';
import type { Renderer } from '../render/renderer';
import type { Cell, Facing, PortKind } from '../model/types';
import type { TerrainKind } from '../grid/grid';
import { cellKey } from '../model/geometry';
import { tr } from '../i18n';
import { isTouchUI } from '../platform';
import { nextInFamily } from './logistics';
import { showHoldRing, type HoldRing } from '../ui/holdRing';
import { enterSimMode, exitSimMode, isSimulating, simTogglePlay } from '../ui/simMode';
import { actionOf, isModifierKey, matchesKey, type ActionDef } from '../keybinds';

const ROTS: Facing[] = [0, 90, 180, 270];

const noun = (k: PortKind): string => (k === 'pipe' ? tr('ống') : tr('băng chuyền'));

/** Chuột trái đi quá chừng này pixel thì coi là kéo, không phải bấm. */
const DRAG_PX = 5;

/**
 * Thứ nằm dưới con trỏ để chọn. Ưu tiên theo tầng đang xem: xem mặt đất thì máy → băng
 * → ống; xem trên cao thì ống → máy → băng (ống bắc qua trên băng và van băng).
 */
function pickAt(
  state: AppState,
  layer: 0 | 1,
  cell: Cell,
): { type: 'machine'; uid: number } | { type: 'tile'; kind: PortKind } | null {
  const at = machineAt(state.bp, state.ds, cell);
  // công trình đặt sẵn của căn cứ (dải kho tổng Valley) không chọn được
  const m = at && !at.fixed ? at : undefined;
  const pipe = beltAt(state.bp, 'pipe', cell) ? ({ type: 'tile', kind: 'pipe' } as const) : null;
  const belt = beltAt(state.bp, 'belt', cell) ? ({ type: 'tile', kind: 'belt' } as const) : null;
  const machine = m ? ({ type: 'machine', uid: m.uid } as const) : null;
  const order = layer === 1 ? [pipe, machine, belt] : [machine, belt, pipe];
  return order.find((x) => x !== null) ?? null;
}

/** Cập nhật preview băng/ống theo vị trí con trỏ. */
function refreshPreview(state: AppState, renderer: Renderer, cell: Cell | null): void {
  const tool = state.tool;
  if (tool.kind !== 'link' || !cell) {
    renderer.preview = null;
    renderer.startHint = null;
    return;
  }
  if (!tool.start) {
    // chưa chọn điểm đầu: chỉ báo ô này có bắt đầu được không
    renderer.preview = null;
    renderer.startHint = specAt(state.bp, state.ds, cell, tool.linkKind) ? cell : null;
    return;
  }
  renderer.startHint = null;
  renderer.preview = planBelt(state.bp, state.ds, tool.start, cell, tool.linkKind);
}

/** Kết quả đặt máy / thả nhóm: đặt được không, lý do nếu không (câu của `ops`, chưa ghép "Không đặt được"). */
export interface PlaceResult {
  ok: boolean;
  reason?: string;
}
export interface CommitResult extends PlaceResult {
  sel?: Selection;
}
/** "Không đặt được: <lý do> — " để ghép trước "đã trả về chỗ cũ"; không có lý do ⇒ chuỗi rỗng. */
export const failNote = (reason?: string): string => (reason ? `${tr('Không đặt được: {0}', reason)} — ` : '');

/** Nhóm Chung: Map chỉ tự lo hoàn tác / làm lại, bộ nhớ tạm, máy ghim (phần còn lại ở `main.ts`, checklist, hướng dẫn…);
 *  thao tác của hoàn cảnh khác (mô phỏng ⇄ chỉnh sửa) bỏ qua. */
const MAP_GENERAL = /^(undo|redo|clipCopy|clipPaste|pin\d+)$/;
function skipAction(a: ActionDef, sim: boolean): boolean {
  if (a.scope === 'general') return !MAP_GENERAL.test(a.id);
  if (a.ctx === 'sim') return !sim;
  if (a.ctx === 'edit') return sim;
  return false;
}

/**
 * Gắn chuột + bàn phím vào canvas.
 *
 * Mỗi công cụ chỉ xử lý đúng ý nghĩa của nó; phần pan/zoom nằm chung vì người dùng
 * cần di chuyển khung nhìn ở mọi công cụ.
 */
export function attachInput(canvas: HTMLCanvasElement, state: AppState, renderer: Renderer): InputHandle {
  let panning = false;
  let painting = false;
  let last = { x: 0, y: 0 };
  let spaceDown = false;
  /** Đang giữ Space mà đã kéo bản đồ ⇒ thả Space không tính là "bấm Space" (đổi chế độ máy — người dùng 2026-10-06). */
  let spacePanned = false;
  /**
   * Chế độ hàng loạt (X): chuột phải vừa nhấn — chưa biết là **bấm** (thoát chế độ) hay **kéo hộp** (bỏ chọn nhiều).
   * `rboxing` = đang kéo hộp bỏ chọn.
   */
  let rpress: { sx: number; sy: number; cell: Cell } | null = null;
  let rboxing = false;
  /**
   * Giữ chuột phải lúc đang preview máy: preview đứng yên tại `center`, rê chuột để
   * xoay theo hướng rê. Thả ra thì preview lại bám con trỏ, giữ hướng mới.
   */
  let lock: { center: Cell; sx: number; sy: number } | null = null;
  /**
   * Chuột trái vừa nhấn ở công cụ Chọn — chưa biết là **bấm** hay **kéo**. Chuột đi quá
   * `DRAG_PX` thì thành kéo: bắt đầu trên máy (không Ctrl) ⇒ kéo máy/nhóm đi; còn lại ⇒
   * kéo khung chọn vùng. Thả ra mà chưa đi xa ⇒ là một cú bấm.
   */
  let press: { sx: number; sy: number; cell: Cell; ctrl: boolean } | null = null;
  /**
   * Vòng đếm giữ chuột trái trên máy / nhóm đang chọn (người dùng 2026-10-11, `ui/holdRing.ts`): đầy sau 0,5 s ⇒ nhấc lên,
   * rê theo chuột, thả là đặt. Rê ra khỏi vòng / nhả chuột / bấm nút khác trước khi đầy ⇒ huỷ vòng.
   */
  let ring: HoldRing | null = null;
  const clearHold = (): void => {
    ring?.remove();
    ring = null;
  };
  /** Đang kéo khung chọn vùng; `add` = giữ Ctrl ⇒ thêm vào lựa chọn cũ. */
  let boxing: { add: boolean } | null = null;

  /**
   * Van/cầu 1×1 đang preview trên một ô băng/ống: các hướng quay khớp với tuyến ở đó (rỗng nếu
   * không nằm trên tuyến nào hợp lệ).
   */
  const inlineRotsHere = (): Facing[] => {
    const tool = state.tool;
    if (tool.kind !== 'place') return [];
    const def = state.ds.machines.get(tool.machineId);
    const c = lock?.center ?? renderer.hover.cell;
    if (!def?.router || !c) return [];
    return inlineRotations(state.bp, state.ds, def, c.x, c.z);
  };

  /** Góc trên-trái của preview: tại chỗ đã khoá, hoặc canh giữa quanh con trỏ. */
  const updateGhost = (): void => {
    // rê van/cầu lên băng/ống ⇒ tự xoay cho khớp đoạn tuyến đó (người dùng yêu cầu 2026-09-28)
    const t0 = state.tool;
    if (t0.kind === 'place' && !lock) {
      const rots = inlineRotsHere();
      if (rots.length > 0 && !rots.includes(t0.rot)) state.setTool({ ...t0, rot: rots[0]! });
    }
    const tool = state.tool;
    const center = lock?.center ?? renderer.hover.cell;
    const def = tool.kind === 'place' ? state.ds.machines.get(tool.machineId) : undefined;
    renderer.ghost = tool.kind === 'place' && def && center ? originFor(def, tool.rot, center) : null;
    if ((tool.kind === 'group' || tool.kind === 'stamp') && center) renderer.groupTarget = center;
  };

  /** Đang kéo thả một van / cầu bằng chuột trái (công cụ di chuyển, thả chuột là đặt). */
  let dragPlace = false;
  /**
   * Bấm đặt máy đang cầm (đặt mới / di chuyển / sao chép) tại ô `cell` — dùng chung cho bấm và kéo thả van. Trả về
   * **kết quả có cấu trúc** (rà soát 2026-10-14): nơi gọi biết đặt được hay không mà không phải so câu chữ của
   * `state.message` (đổi câu / bản dịch là hỏng).
   */
  const placeAt = (cell: Cell): PlaceResult => {
    const tool = state.tool;
    if (tool.kind !== 'place') return { ok: false };
    const def = state.ds.machines.get(tool.machineId);
    if (!def) return { ok: false };
    let res: PlaceResult = { ok: false };
    const at = renderer.ghost ?? originFor(def, tool.rot, cell);
    const mode = tool.mode ?? 'new';

    if (mode === 'move' && tool.sourceUid !== undefined) {
      const uid = tool.sourceUid;
      let ok = false;
      state.mutate(tr('Di chuyển máy'), () => {
        const r = moveMachine(state.bp, state.ds, state.terrain, uid, at.x, at.z, tool.rot);
        // chế độ đã đổi bằng Tab trong lúc di chuyển
        if (r.ok && tool.machineMode) setMode(state.bp, state.ds, uid, tool.machineMode);
        ok = r.ok;
        res = r.ok ? { ok: true } : { ok: false, reason: r.reason };
        state.message = r.ok ? tr('Đã di chuyển máy') : tr('Không đặt được: {0}', r.reason);
      });
      if (ok) {
        lock = null;
        enterTool(state, renderer, { kind: 'select' });
        state.select(uid);
      }
      return res;
    }
    if (mode === 'copy' && tool.sourceUid !== undefined) {
      const src = tool.sourceUid;
      state.mutate(tr('Sao chép máy'), () => {
        const r = copyMachine(state.bp, state.ds, state.terrain, src, at.x, at.z, tool.rot);
        // bản sao nhận chế độ đã chọn bằng Tab trong lúc sao chép (máy gốc giữ nguyên)
        if (r.ok && r.uid !== undefined && tool.machineMode) setMode(state.bp, state.ds, r.uid, tool.machineMode);
        res = r.ok ? { ok: true } : { ok: false, reason: r.reason };
        state.message = r.ok ? tr('Đã đặt bản sao — đặt tiếp, hoặc Esc để tắt') : tr('Không đặt được: {0}', r.reason);
      });
      return res; // vẫn ở chế độ sao chép để đặt tiếp
    }
    state.mutate(tr('Đặt máy'), () => {
      const r = addMachine(state.bp, state.ds, state.terrain, tool.machineId, at.x, at.z, tool.rot);
      // chế độ chọn bằng Tab trước khi đặt (người dùng 2026-10-02) — máy đặt xuống đã đúng chế độ, cổng đúng chỗ
      if (r.ok && r.uid !== undefined && tool.machineMode) setMode(state.bp, state.ds, r.uid, tool.machineMode);
      // dán van / cầu từ bộ nhớ tạm: chép thiết lập của máy mẫu
      const t = tool.template;
      const placed = r.ok ? state.bp.machines.find((v) => v.uid === r.uid) : undefined;
      if (t && placed) {
        if (t.filterItem !== undefined) placed.filterItem = t.filterItem;
        if (t.filterRate !== undefined) placed.filterRate = t.filterRate;
        placed.binding = { ...t.binding };
      }
      res = r.ok ? { ok: true } : { ok: false, reason: r.reason };
      state.message = r.ok ? (t ? tr('Đã dán — đặt tiếp, hoặc Esc để tắt') : tr('Đã đặt máy')) : tr('Không đặt được: {0}', r.reason);
    });
    return res;
  };

  /** Bấm (không kéo) ở công cụ Chọn. */
  const clickSelect = (cell: Cell, ctrl: boolean): void => {
    const hit = pickAt(state, renderer.activeLayer, cell);
    if (!hit) {
      if (!ctrl) state.setSelection(emptySelection()); // Ctrl+bấm chỗ trống: giữ nguyên
      return;
    }
    if (hit.type === 'machine') {
      if (ctrl) state.setSelection(toggleMachine(state.sel, hit.uid));
      else state.select(hit.uid);
      return;
    }
    state.setSelection(clickTile(state.sel, state.bp, state.ds, hit.kind, cell, ctrl));
  };

  /** Ô `cell` có thứ nhấc lên được bằng cách giữ chuột: một máy bất kỳ, hoặc ô băng / ống thuộc vùng đang chọn. */
  const liftable = (cell: Cell): boolean => {
    const m = machineAt(state.bp, state.ds, cell);
    if (m) return !m.fixed;
    return [...state.sel.tiles].some((k) => k.endsWith(`:${cell.x},${cell.z}`));
  };
  /**
   * Vòng đếm đã đầy: nhấc máy (hoặc cả nhóm đang chọn chứa nó) lên, rê theo chuột, nhả chuột là đặt (`mouseup`); thả vào
   * chỗ vướng ⇒ về chỗ cũ. Ô băng / ống thuộc vùng chọn ⇒ nhấc cả vùng chọn.
   */
  const liftAt = (cell: Cell): void => {
    const hit = machineAt(state.bp, state.ds, cell);
    const m = hit && !hit.fixed ? hit : undefined;
    if (!m) {
      if (!liftable(cell)) return;
      startGroup(state, renderer, 'move', cell);
      updateGhost();
      state.emit('view');
      return;
    }
    // van / cầu kéo một mình (người dùng 2026-10-02): đi đường của công cụ di chuyển (M) — rê lên băng/ống thì tự
    // xoay theo chiều tuyến, thả xuống thì thay ô tuyến đó (nhóm không làm được hai việc này)
    const mdef = state.ds.machines.get(m.machineId);
    const alone = !state.sel.machines.has(m.uid) || (state.sel.machines.size === 1 && state.sel.tiles.size === 0);
    if (mdef?.router && alone) {
      state.select(m.uid);
      startMove(state, renderer, m.uid);
      dragPlace = true;
      updateGhost();
      state.emit('view');
      return;
    }
    // máy nằm trong nhóm đang chọn ⇒ kéo cả nhóm; chưa chọn ⇒ chọn riêng nó rồi kéo
    if (!state.sel.machines.has(m.uid)) state.select(m.uid);
    startGroup(state, renderer, 'move', cell);
    updateGhost();
    state.emit('view');
  };
  /**
   * Chuột đã đi đủ xa từ lúc nhấn (và không còn vòng đếm): **kéo khung chọn vùng** — kể cả khi bắt đầu trên máy (luật đổi
   * 2026-10-11: trước đây rê ngay trên máy là kéo máy đi; nay phải giữ đủ vòng đếm (0,5 s) mới nhấc).
   */
  const beginDrag = (p: { cell: Cell; ctrl: boolean }): void => {
    boxing = { add: p.ctrl };
    renderer.box = { a: p.cell, b: renderer.hover.cell ?? p.cell };
    state.emit('view');
  };

  /** Thoát chế độ hàng loạt (X / Esc / bấm chuột phải): bỏ luôn vùng chọn — *suy luận*, như thoát chế độ này trong game. */
  const exitBatch = (): void => {
    rpress = null;
    rboxing = false;
    renderer.box = null;
    renderer.boxMode = 'add';
    state.sel = emptySelection();
    state.setBatch(false);
    state.notify(tr('Đã thoát chế độ chọn hàng loạt'));
  };
  /** Chế độ hàng loạt: **nhấn và giữ** chuột trái trên một máy ⇒ di chuyển cả vùng chọn (máy chưa chọn thì thêm vào). */
  const batchHold = (cell: Cell): void => {
    const m = machineAt(state.bp, state.ds, cell);
    if (!m || m.fixed) return;
    if (!state.sel.machines.has(m.uid)) state.setSelection(toggleMachine(state.sel, m.uid));
    startGroup(state, renderer, 'move', cell);
    updateGhost();
    state.emit('view');
  };

  /** Đang nhấc máy / nhóm bằng **chuột trái** (giữ đủ vòng đếm, hoặc kéo van) — nhả chuột là đặt. */
  const lifting = (): boolean => dragPlace || (state.tool.kind === 'group' && state.tool.drag === true);
  /** Huỷ lần nhấc bằng chuột trái: máy / nhóm về chỗ cũ (bản vẽ chưa đổi gì), lựa chọn giữ nguyên. */
  const cancelLift = (): void => {
    const t = state.tool;
    if (dragPlace && t.kind === 'place') {
      dragPlace = false;
      const src = t.sourceUid;
      lock = null;
      enterTool(state, renderer, { kind: 'select' });
      if (src !== undefined) state.select(src);
      state.notify(tr('Đã huỷ di chuyển — về chỗ cũ'));
      return;
    }
    if (t.kind === 'group' && t.drag) cancelGroup(tr('Đã huỷ di chuyển — về chỗ cũ'));
  };

  /** Huỷ nhóm đang cầm: bản vẽ chưa đổi gì nên chỉ cần thoát chế độ. */
  const cancelGroup = (message: string): void => {
    lock = null;
    enterTool(state, renderer, { kind: 'select' });
    state.notify(message);
  };

  const localPoint = (e: MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const updateHover = (e: MouseEvent): void => {
    const p = localPoint(e);
    const cell = renderer.camera.toCell(p.x, p.y);
    const tool = state.tool;
    const moved = !renderer.hover.cell || renderer.hover.cell.x !== cell.x || renderer.hover.cell.z !== cell.z;
    renderer.hover = { cell, port: null };
    // tìm đường chỉ khi con trỏ sang ô khác — di chuột trong cùng một ô thì giữ nguyên
    if (moved || (tool.kind === 'link' && !renderer.preview && tool.start)) refreshPreview(state, renderer, cell);
    updateGhost();
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    const p = localPoint(e);
    last = p;

    // bấm nút chuột khác lúc đang giữ vòng đếm ⇒ huỷ vòng; lúc đang nhấc bằng chuột trái: chuột phải vẫn là xoay, chuột
    // giữa ⇒ huỷ, máy về chỗ cũ (người dùng 2026-10-11)
    if (ring && e.button !== 0) {
      clearHold();
      press = null;
    }
    if (e.button === 1 && lifting()) {
      cancelLift();
      return;
    }
    // Chuột phải khi đang preview máy = khoá tại chỗ để xoay; ngoài ra vẫn là kéo bản vẽ.
    // Chuột giữa và Space+kéo luôn là kéo bản vẽ.
    const holding = state.tool.kind === 'place' || state.tool.kind === 'group' || state.tool.kind === 'stamp';
    // chế độ hàng loạt: chuột phải = bấm để thoát / kéo hộp để bỏ chọn nhiều (kéo bản đồ: chuột giữa hoặc Space + kéo)
    if (e.button === 2 && state.batch && state.tool.kind === 'select' && !spaceDown) {
      updateHover(e);
      if (renderer.hover.cell) rpress = { sx: p.x, sy: p.y, cell: renderer.hover.cell };
      return;
    }
    if (e.button === 2 && holding && !spaceDown) {
      updateHover(e);
      if (renderer.hover.cell) lock = { center: renderer.hover.cell, sx: p.x, sy: p.y };
      updateGhost();
      state.emit('view');
      return;
    }
    if (e.button === 1 || e.button === 2 || spaceDown) {
      panning = true;
      if (spaceDown) spacePanned = true;
      return;
    }
    if (e.button !== 0) return;

    updateHover(e);
    const cell = renderer.hover.cell;
    if (!cell) return;

    switch (state.tool.kind) {
      case 'select': {
        if (state.batch) {
          // chế độ hàng loạt: bấm = chọn / bỏ chọn (như Ctrl+bấm), kéo = hộp chọn thêm, giữ trên máy = di chuyển
          press = { sx: p.x, sy: p.y, cell, ctrl: true };
          clearHold();
          if (machineAt(state.bp, state.ds, cell))
            ring = showHoldRing(e.clientX, e.clientY, false, () => {
              ring = null;
              if (!press) return;
              const at = press.cell;
              press = null;
              batchHold(at);
            });
          break;
        }
        // chưa làm gì cả: đợi xem là bấm hay kéo (xem `press`)
        press = { sx: p.x, sy: p.y, cell, ctrl: e.ctrlKey || e.metaKey };
        clearHold();
        // giữ yên trên máy / nhóm đang chọn (không Ctrl) ⇒ vòng đếm 0,5 s, đầy thì nhấc lên (người dùng 2026-10-11)
        if (!press.ctrl && liftable(cell))
          ring = showHoldRing(e.clientX, e.clientY, false, () => {
            ring = null;
            if (!press) return;
            const start = press;
            press = null;
            liftAt(start.cell);
          });
        break;
      }
      case 'group': {
        if (state.tool.drag) break; // đang kéo bằng chuột trái: thả chuột mới đặt
        dropGroup(state, renderer, lock?.center ?? cell);
        break;
      }
      case 'stamp': {
        dropStamp(state, lock?.center ?? cell);
        break;
      }
      case 'pair': {
        // chỉ định đầu kia của cặp ống ngầm ngay trên map (người dùng 2026-09-29)
        const uid = state.tool.uid;
        const target = machineAt(state.bp, state.ds, cell);
        if (!target || !pairCandidates(state.bp, state.ds, uid).some((c) => c.uid === target.uid)) {
          state.notify(tr('Bấm vào một máy đang tô xanh để ghép — Esc để thôi'));
          break;
        }
        state.mutate(tr('Ghép cặp ống ngầm'), () => {
          const r = setPairTarget(state.bp, state.ds, uid, target.uid);
          state.message = r.ok ? tr('Đã ghép với #{0}', target.uid) : (r.reason ?? tr('Không ghép được'));
        });
        enterTool(state, renderer, { kind: 'select' });
        state.select(uid);
        break;
      }
      case 'place': {
        placeAt(cell);
        break;
      }
      case 'link': {
        const tool = state.tool;
        const kind = tool.linkKind;
        if (!tool.start) {
          const spec = specAt(state.bp, state.ds, cell, kind);
          if (!spec) {
            state.notify(tr('Ô này đã có công trình ở tầng của {0}', noun(kind)));
            break;
          }
          state.setTool({ ...tool, start: spec });
          refreshPreview(state, renderer, cell);
          state.notify(
            spec.type === 'machine'
              ? tr('Rê tới đích — cổng ra sẽ tự chọn theo đường ngắn nhất. Bấm để đặt, Esc để huỷ')
              : tr('Rê tới đích rồi bấm để đặt, Esc để huỷ'),
          );
          break;
        }
        const plan = planBelt(state.bp, state.ds, tool.start, cell, kind);
        if (!plan.ok) {
          state.notify(tr('Không đặt được: {0}', plan.reason));
          break;
        }
        let next: StartSpec | undefined;
        state.mutate(kind === 'pipe' ? tr('Đặt ống') : tr('Đặt băng chuyền'), () => {
          const { last } = commitPlan(state.bp, plan);
          // Không chạm cổng vào nào ⇒ coi là đang nối tiếp: đoạn sau bắt đầu ngay tại ô cuối
          // của đoạn vừa đặt (ô đó sẽ bị thay, hướng vào giữ nguyên). Esc để dừng.
          // vào cầu thì đi tiếp ra phía bên kia cầu, cùng hướng
          const through = plan.to ? bridgeExit(state.bp, state.ds, plan.to) : undefined;
          next = through ?? (plan.endsAtPort ? undefined : { type: 'tile', x: last.x, z: last.z });
          state.message = through
            ? tr('Đã qua cầu — kéo tiếp phía bên kia, Esc để dừng')
            : plan.endsAtPort
              ? tr('Đã nối {0} vào máy', noun(kind))
              : tr('Đã đặt {0} ô — kéo tiếp để nối, Esc để dừng', plan.cells.length);
        });
        state.setTool({ kind: 'link', linkKind: kind, start: next });
        refreshPreview(state, renderer, cell);
        break;
      }
      case 'erase': {
        const m = machineAt(state.bp, state.ds, cell);
        if (m?.fixed) {
          state.notify(tr('Công trình đặt sẵn của căn cứ — không xoá được'));
          break;
        }
        if (m) {
          state.mutate(tr('Xoá máy'), () => removeMachine(state.bp, m.uid));
          break;
        }
        const kind: PortKind = renderer.activeLayer === 1 ? 'pipe' : 'belt';
        state.mutate(tr('Xoá ô {0}', noun(kind)), () => {
          if (!removeBeltAt(state.bp, kind, cell)) state.message = tr('Không có gì để xoá ở đây');
        });
        break;
      }
      case 'terrain': {
        painting = true;
        applyTerrain(state, cell, state.tool.paint, true);
        break;
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (fromTouch(e)) return;
    const p = localPoint(e);
    if (lock) {
      // đang giữ chuột phải: preview đứng yên, hướng máy theo hướng rê (quy về hệ bản vẽ
      // khi camera đang xoay — rê lên màn hình vẫn là "hướng lên" mà người dùng thấy)
      const tool = state.tool;
      const v = renderer.camera.screenVec(p.x - lock.sx, p.y - lock.sy);
      const rot = rotFromDrag(v.x, v.y, 18);
      if (tool.kind === 'place' && rot !== null && rot !== tool.rot) {
        state.setTool({ ...tool, rot });
        updateGhost();
      }
      // nhóm: rê lên = giữ hướng cũ, rê sang phải = quay 90°, … — giống máy đơn
      const turns = rot === null ? null : ((rot / 90) as 0 | 1 | 2 | 3);
      if ((tool.kind === 'group' || tool.kind === 'stamp') && turns !== null && turns !== tool.turns) {
        state.setTool({ ...tool, turns });
        updateGhost();
      }
      state.emit('view');
      return;
    }
    if (panning) {
      renderer.camera.pan(p.x - last.x, p.y - last.y);
      last = p;
      state.emit('view');
      return;
    }
    if (rpress) {
      updateHover(e);
      if (!rboxing && Math.hypot(p.x - rpress.sx, p.y - rpress.sy) >= DRAG_PX) {
        rboxing = true;
        renderer.boxMode = 'remove';
      }
      if (rboxing && renderer.hover.cell) renderer.box = { a: rpress.cell, b: renderer.hover.cell };
      state.emit('view');
      return;
    }
    updateHover(e);
    // còn vòng đếm: rê trong vòng thì vòng vẫn chạy; ra khỏi vòng ⇒ huỷ vòng, cú rê thành kéo khung chọn
    if (press && (ring ? !ring.inside(e.clientX, e.clientY) : Math.hypot(p.x - press.sx, p.y - press.sy) >= DRAG_PX)) {
      const start = press;
      press = null;
      clearHold();
      beginDrag(start);
    }
    if (boxing && renderer.box && renderer.hover.cell) renderer.box = { a: renderer.box.a, b: renderer.hover.cell };
    if (painting && state.tool.kind === 'terrain' && renderer.hover.cell) {
      applyTerrain(state, renderer.hover.cell, state.tool.paint, false);
    }
    state.emit('view');
  });

  window.addEventListener('mouseup', (e) => {
    if (fromTouch(e)) return;
    panning = false;
    painting = false;
    if (e.button === 0) {
      clearHold();
      if (press) {
        const { cell, ctrl } = press;
        press = null;
        clickSelect(cell, ctrl);
      } else if (boxing && renderer.box) {
        const picked = boxSelection(state.bp, state.ds, renderer.box.a, renderer.box.b);
        const add = boxing.add;
        boxing = null;
        renderer.box = null;
        state.setSelection(add ? unionSelection(state.sel, picked) : picked);
      } else if (dragPlace && state.tool.kind === 'place') {
        // thả van / cầu đang kéo: đặt như bấm của công cụ di chuyển; không đặt được ⇒ về chỗ cũ
        dragPlace = false;
        updateHover(e);
        const src = state.tool.sourceUid;
        const res = renderer.hover.cell ? placeAt(renderer.hover.cell) : null;
        if (state.tool.kind === 'place') {
          const why = failNote(res?.reason);
          lock = null;
          enterTool(state, renderer, { kind: 'select' });
          if (src !== undefined) state.select(src);
          state.notify(tr('{0}đã trả về chỗ cũ', why));
        }
      } else if (state.tool.kind === 'group' && state.tool.drag) {
        updateHover(e);
        const target = lock?.center ?? renderer.hover.cell;
        // thả vào chỗ vướng ⇒ huỷ, máy về chỗ cũ (người dùng đã chốt)
        const out: { reason?: string } = {};
        if (!target || !dropGroup(state, renderer, target, out)) {
          const why = failNote(out.reason);
          cancelGroup(tr('{0}đã trả về chỗ cũ', why));
        }
        lock = null;
      }
      dragPlace = false;
    }
    if (e.button === 2 && rpress) {
      if (rboxing && renderer.box) {
        const picked = boxSelection(state.bp, state.ds, renderer.box.a, renderer.box.b);
        renderer.box = null;
        renderer.boxMode = 'add';
        rboxing = false;
        rpress = null;
        state.setSelection(subtractSelection(state.sel, picked));
      } else {
        rpress = null;
        exitBatch(); // bấm chuột phải (không kéo) = thoát chế độ hàng loạt
      }
    }
    if (e.button === 2 && lock) {
      lock = null; // thả chuột phải: preview lại bám con trỏ, giữ hướng mới
      updateHover(e);
      state.emit('view');
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = localPoint(e);
      // zoom mượt: chỉ đổi đích, vòng lặp khung hình trượt tới — xem Camera.update
      renderer.camera.zoomTowards(p.x, p.y, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    },
    { passive: false },
  );

  // Phím di chuyển đang giữ — đọc mỗi khung hình trong `tick`, không dựa vào lặp phím của hệ
  // điều hành. Giá trị = thời điểm tự nhả (`null` = đợi keyup): phím do bộ gõ tiếng Việt gửi
  // lại không có keyup tin được nên tự nhả sau `INJECTED_HOLD_MS` nếu không được gửi tiếp.
  /** Phím di chuyển đang giữ → hướng + hạn tự nhả (phím do bộ gõ gửi). */
  const held = new Map<string, { v: [number, number]; until: number | null }>();
  /** Hướng của 4 thao tác di chuyển bản đồ (phím mặc định W A S D / mũi tên — đổi được, `keybinds.ts`). */
  const MOVE_DIRS: Record<string, [number, number]> = {
    'map.up': [0, -1],
    'map.down': [0, 1],
    'map.left': [-1, 0],
    'map.right': [1, 0],
  };
  let lastMouse: MouseEvent | null = null;
  canvas.addEventListener('mousemove', (e) => {
    if (!fromTouch(e)) lastMouse = e;
  });

  /**
   * Thả máy kéo từ bảng chọn (người dùng 2026-10-02; `palette.ts` đã cầm máy khi bắt đầu kéo): thả trên bản vẽ ⇒
   * đặt **một** máy ở đó rồi thôi cầm (lỗi thì báo như bấm đặt); thả ngoài bản vẽ ⇒ huỷ.
   */
  window.addEventListener(PALETTE_DROP_EVENT, (ev) => {
    const { clientX, clientY } = (ev as CustomEvent<{ clientX: number; clientY: number }>).detail;
    const kind = state.tool.kind;
    if (kind !== 'place' && kind !== 'stamp') return;
    const r = canvas.getBoundingClientRect();
    const inside = clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom && canvas.offsetParent !== null;
    lock = null;
    if (inside && isTouchUI()) {
      // điện thoại (người dùng 2026-10-11): thả máy / bản vẽ kéo từ thanh chọn máy ⇒ **chưa đặt**, preview nằm ở chỗ thả
      // cùng ba nút nổi Đặt / Xoay / Huỷ phía trên (`touchActions.ts`)
      updateHover({ clientX, clientY } as MouseEvent);
      updateGhost();
      state.notify(tr('Bấm Đặt để đặt, Xoay để xoay, hoặc rê preview sang chỗ khác'));
      return;
    }
    if (inside) {
      updateHover({ clientX, clientY } as MouseEvent);
      const cell = renderer.hover.cell;
      // bản vẽ ghim kéo từ thanh thu gọn (người dùng 2026-10-02): đặt bản vẽ như bấm chuột trái
      const name = state.tool.kind === 'stamp' ? state.tool.name : '';
      if (cell && kind === 'stamp') {
        if (dropStamp(state, cell)) state.message = tr('Đã đặt bản vẽ "{0}"', name);
      } else if (cell) placeAt(cell);
      const msg = state.message;
      enterTool(state, renderer, { kind: 'select' });
      state.notify(msg);
    } else {
      enterTool(state, renderer, { kind: 'select' });
      state.notify(kind === 'stamp' ? tr('Đã thôi đặt bản vẽ') : tr('Đã huỷ đặt máy'));
    }
  });

  /** Backspace đang hoãn — xem `keys.ts`: có thể là Backspace do bộ gõ tiếng Việt gửi. */
  let pendingBackspace: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    // ô nhập chữ (tìm máy, tìm icon, tên bản vẽ): để trình duyệt + bộ gõ lo, gõ tiếng Việt bình thường
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    // cửa sổ Bản vẽ đang mở: phím tắt của bản vẽ không được chạy ngầm phía sau
    if (document.body.classList.contains('modal-open')) return;
    // đang ở tab Modeler: bản vẽ lưới bị ẩn, không nhận phím
    if (document.getElementById('app')?.classList.contains('modeler-mode')) return;

    const injected = isInjected(e);
    // ký tự bộ gõ gửi lại ngay sau Backspace ⇒ Backspace đó là của bộ gõ, không phải người dùng xoá
    if (injected && pendingBackspace !== null) {
      clearTimeout(pendingBackspace);
      pendingBackspace = null;
    }
    const key = hotkeyOf(e);
    if (key === null) return;
    // phím → thao tác theo bảng phím (`keybinds.ts`); nhóm Chung: chỉ những thao tác Map tự lo (hoàn tác, bộ nhớ tạm, máy
    // ghim) — phần còn lại do `main.ts` / checklist / hướng dẫn / Alt
    const sim = isSimulating();
    const act = actionOf(e, ['map', 'general'], (a) => skipAction(a, sim));

    // Đang giữ chuột trái (vòng đếm) hoặc đang nhấc máy / nhóm bằng chuột trái (người dùng 2026-10-11): bấm phím khác ⇒ huỷ,
    // máy về chỗ cũ. Được phép: xoay (R), đổi chế độ (Space) và phím bổ trợ.
    if (!injected && (ring || lifting())) {
      const modifier = isModifierKey(key);
      if (ring && !modifier) {
        clearHold();
        press = null;
      } else if (lifting() && !modifier && act !== 'map.rotate' && act !== 'map.mode') {
        e.preventDefault();
        cancelLift();
        return;
      }
    }
    if (!act) return;

    // chế độ Simulation (người dùng 2026-10-03): Space = chạy / dừng; mọi phím khác như Map thường (vẫn chỉnh sửa được)
    if (act === 'map.simPlay') {
      e.preventDefault();
      if (!e.repeat) simTogglePlay();
      return;
    }

    if (act === 'map.mode') {
      // Space: bấm nhả = đổi chế độ máy (ở keyup), giữ + kéo = kéo bản vẽ. Chặn mặc định để Space không "bấm" hộ nút
      // đang được focus.
      e.preventDefault();
      if (!e.repeat) {
        spaceDown = true;
        spacePanned = false;
      }
      return;
    }

    const dir = MOVE_DIRS[act];
    if (dir) {
      e.preventDefault();
      held.set(key, { v: dir, until: injected ? performance.now() + INJECTED_HOLD_MS : null });
      return;
    }

    if (act === 'map.delete' && key === 'backspace') {
      if (injected) return;
      // hoãn một nhịp: bộ gõ tiếng Việt xoá ký tự cũ bằng Backspace rồi gửi ký tự có dấu
      if (pendingBackspace !== null) clearTimeout(pendingBackspace);
      pendingBackspace = setTimeout(() => {
        pendingBackspace = null;
        if (selectionSize(state.sel) > 0 && state.tool.kind === 'select') deleteSelected(state, renderer);
      }, BACKSPACE_HOLD_MS);
      return;
    }

    e.preventDefault();
    const pin = /^pin(\d+)$/.exec(act);
    if (pin) {
      // Phím số 1 → 0: cầm máy đã ghim thứ 1 → 10 trong bảng chọn máy, theo thứ tự từ trên xuống (người dùng 2026-09-29)
      const slot = Number(pin[1]) - 1;
      const id = pinnedMachineIds(state.ds)[slot];
      if (!id) {
        state.notify(tr('Chưa ghim máy thứ {0} — bấm ghim ở bảng chọn máy bên trái', slot + 1));
        return;
      }
      lock = null;
      enterTool(state, renderer, { kind: 'place', machineId: id, rot: 0, mode: 'new' });
      updateGhost();
      return;
    }

    switch (act) {
      case 'undo':
        state.undo();
        break;
      case 'redo':
        state.redo();
        break;
      case 'map.camRot':
      case 'map.camRotBack':
        // xoay camera 90° — chặn luôn phím tải lại trang của trình duyệt
        if (!e.repeat) rotateCamera(act === 'map.camRotBack' ? -1 : 1);
        break;
      case 'clipPaste':
        // dán bộ nhớ tạm (người dùng 2026-09-29) — cả khi đã chuyển sang tab Map khác
        if (!e.repeat && state.tool.kind !== 'group') pasteClipboard(state, renderer);
        break;
      case 'clipCopy':
        // chép vào bộ nhớ tạm, không cầm preview; dán để đặt — kể cả sang tab Map khác (người dùng 2026-09-29)
        if (state.tool.kind !== 'select' || (state.selection === null && selectionSize(state.sel) === 0)) break;
        if (!e.repeat) copyToClipboard(state);
        break;
      case 'map.sim':
        // bật / tắt mô phỏng (người dùng 2026-10-13)
        if (e.repeat) break;
        if (sim) exitSimMode();
        else enterSimMode();
        break;
      case 'map.cancel':
        if (boxing || press) {
          clearHold();
          boxing = null;
          press = null;
          renderer.box = null;
          state.notify(tr('Đã huỷ chọn vùng'));
          break;
        }
        if (state.batch && state.tool.kind === 'select') {
          exitBatch();
          break;
        }
        if (state.tool.kind === 'stamp') {
          lock = null;
          enterTool(state, renderer, { kind: 'select' });
          state.notify(tr('Đã thôi đặt bản vẽ'));
          break;
        }
        if (state.tool.kind === 'pair') {
          const uid = state.tool.uid;
          enterTool(state, renderer, { kind: 'select' });
          state.select(uid);
          state.notify(tr('Đã thôi ghép cặp'));
          break;
        }
        if (state.tool.kind === 'group') {
          // bản vẽ chưa đổi ⇒ thoát là nhóm "về chỗ cũ"; lựa chọn giữ nguyên
          cancelGroup(state.tool.mode === 'move' ? tr('Đã huỷ di chuyển — về chỗ cũ') : tr('Đã tắt sao chép'));
          break;
        }
        // Ở chế độ đặt băng/ống, Esc tắt hẳn chế độ đó (kể cả đang nối tiếp dở) và về Chọn.
        if (state.tool.kind === 'link') {
          const kind = state.tool.linkKind;
          enterTool(state, renderer, { kind: 'select' });
          state.notify(tr('Đã tắt chế độ đặt {0}', noun(kind)));
          break;
        }
        if (state.tool.kind === 'place') {
          // di chuyển: bản vẽ chưa đổi gì ⇒ thoát là máy "về chỗ cũ"; sao chép: tắt preview.
          // Cả hai giữ lựa chọn trên máy gốc để làm tiếp thao tác khác.
          const src = state.tool.sourceUid;
          const mode = state.tool.mode ?? 'new';
          lock = null;
          enterTool(state, renderer, { kind: 'select' });
          if (src !== undefined) state.select(src);
          state.notify(mode === 'move' ? tr('Đã huỷ di chuyển — máy về chỗ cũ') : mode === 'copy' ? tr('Đã tắt sao chép') : tr('Đã huỷ đặt máy'));
          break;
        }
        enterTool(state, renderer, { kind: 'select' });
        state.select(null);
        break;
      case 'map.move':
        if (state.tool.kind === 'group') break;
        if (state.selection !== null) startMove(state, renderer, state.selection);
        else startGroup(state, renderer, 'move');
        break;
      case 'map.labels':
        toggleLabels(state, renderer);
        break;
      case 'map.copy':
        // C = sao chép, preview bám con trỏ để đặt ngay (Ctrl+C mới là chép vào bộ nhớ tạm — người
        // dùng 2026-09-29 đảo lại)
        if (state.tool.kind === 'group') break;
        if (state.selection !== null) startCopy(state, renderer, state.selection);
        else startGroup(state, renderer, 'copy');
        break;
      case 'map.belt':
        enterTool(state, renderer, { kind: 'link', linkKind: 'belt' });
        break;
      case 'map.pipe':
        enterTool(state, renderer, { kind: 'link', linkKind: 'pipe' });
        break;
      case 'map.rotate': {
        if (state.tool.kind === 'place') {
          // van/cầu trên tuyến: R chỉ đổi giữa các hướng khớp với tuyến
          const rots = inlineRotsHere();
          const next =
            rots.length > 0
              ? rots[(rots.indexOf(state.tool.rot) + 1) % rots.length]!
              : ROTS[(ROTS.indexOf(state.tool.rot) + 1) % 4]!;
          state.setTool({ ...state.tool, rot: next });
          updateGhost();
        } else if (state.tool.kind === 'group' || state.tool.kind === 'stamp') {
          state.setTool({ ...state.tool, turns: ((state.tool.turns + 1) % 4) as 0 | 1 | 2 | 3 });
          updateGhost();
        } else if (state.selection === null && selectionSize(state.sel) > 0 && state.tool.kind === 'select') {
          rotateSelection(state);
        } else if (state.selection !== null) {
          const uid = state.selection;
          state.mutate(tr('Quay máy'), () => {
            const r = rotateMachine(state.bp, state.ds, state.terrain, uid);
            if (!r.ok) state.message = tr('Không quay được: {0}', r.reason);
          });
        }
        break;
      }
      case 'map.delete':
        if (selectionSize(state.sel) > 0 && state.tool.kind === 'select') deleteSelected(state, renderer);
        break;
      // Tab: **bật / tắt** các máy đang chọn (người dùng 2026-10-06, như trong game — tiết kiệm điện). Đổi chế độ máy đã
      // chuyển về Space (bấm nhả nhanh). CapsLock: đổi độ cao mặt đất ⇄ trên cao.
      case 'map.toggleOff': {
        if (e.repeat) break;
        // đang ở bộ băng / ống (vẽ băng / ống hoặc cầm van / cầu của bộ đó): Tab sang loại kế tiếp (người dùng 2026-10-11)
        const next = nextInFamily(state.tool);
        if (next) {
          lock = null;
          enterTool(state, renderer, next);
          if (next.kind === 'link') refreshPreview(state, renderer, renderer.hover.cell);
          updateGhost();
          break;
        }
        if (state.tool.kind === 'select') toggleOffSelected(state);
        else state.notify(tr('Đổi chế độ máy đang cầm: bấm Space'));
        break;
      }
      case 'map.layer':
        if (!e.repeat) toggleLayer(state, renderer);
        break;
      // X: chế độ chọn hàng loạt (người dùng 2026-10-06 — trước đây X là công cụ Tẩy, nay là F)
      case 'map.batch':
        if (e.repeat) break;
        if (state.batch) exitBatch();
        else {
          if (state.tool.kind !== 'select') enterTool(state, renderer, { kind: 'select' });
          state.setBatch(true);
          state.notify(tr('Chế độ chọn hàng loạt — bấm chọn / bỏ chọn, kéo hộp chọn thêm, chuột phải kéo hộp bỏ chọn; X / Esc / chuột phải để thoát'));
        }
        break;
      // F: đang chọn ⇒ xoá (lưu trữ) những gì đang chọn; không chọn gì ⇒ công cụ Tẩy (người dùng 2026-10-06)
      case 'map.erase':
        if (e.repeat) break;
        if (state.tool.kind === 'select' && selectionSize(state.sel) > 0) deleteSelected(state, renderer);
        else enterTool(state, renderer, { kind: 'erase' });
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    // keyup do bộ gõ gửi kèm ký tự thay thế không nói gì về phím thật đang giữ ⇒ bỏ qua
    if (isInjected(e)) return;
    const key = hotkeyOf(e);
    if (spaceDown && matchesKey('map.mode', key)) {
      // bấm nhả Space mà không kéo bản đồ ⇒ đổi chế độ máy (người dùng 2026-10-06: chuyển từ Tab về Space)
      if (!spacePanned && !isSimulating()) switchMode();
      spaceDown = false;
      return;
    }
    if (key) held.delete(key);
    held.delete(e.key.toLowerCase());
  });
  // nút đổi chế độ trên thanh thao tác của điện thoại (`touchActions.ts`) — trước đây nó gửi phím Tab, mà Tab nay là
  // bật / tắt máy ⇒ bấm đổi chế độ lại tắt máy (lỗi người dùng báo 2026-10-07). Gọi thẳng, không qua phím nào.
  window.addEventListener('efp:switch-mode', () => switchMode());
  // chuyển cửa sổ khi đang giữ phím thì keyup không bao giờ tới — xoá hết cho khỏi trôi mãi
  window.addEventListener('blur', () => {
    held.clear();
    spaceDown = false;
  });

  /**
   * Space (bấm nhả) / nút chế độ trên điện thoại: đổi sang chế độ kế tiếp — của máy đang chọn, hoặc của máy đang nhấc lên để di chuyển /
   * sao chép (chế độ mới áp vào máy lúc đặt xuống; sao chép thì chỉ bản sao đổi).
   */
  const switchMode = (): void => {
    const t = state.tool;
    if (t.kind === 'group') {
      // đang cầm / kéo thả một nhóm (kéo một máy bằng chuột trái cũng là nhóm 1 máy — người dùng 2026-09-30):
      // chỉ đổi khi cầm **đúng một máy** (người dùng 2026-09-30: không đổi cả nhóm bằng Tab); cổng trên preview
      // đổi theo, áp vào lúc đặt xuống
      if (state.sel.machines.size !== 1) {
        state.notify(tr('Space chỉ đổi chế độ khi đang cầm một máy — nhóm nhiều máy thì đổi từng máy sau khi đặt'));
        return;
      }
      const modes = { ...(t.modes ?? {}) };
      const labels: string[] = [];
      for (const uid of state.sel.machines) {
        const m = state.bp.machines.find((v) => v.uid === uid);
        const def = m ? state.ds.machines.get(m.machineId) : undefined;
        if (!m || !def?.modes || def.modes.length < 2) continue;
        const ids = def.modes.map((x) => x.id);
        const now = modes[uid] ?? m.mode ?? 'A';
        const next = ids[(ids.indexOf(now) + 1) % ids.length]!;
        modes[uid] = next;
        labels.push(`${def.name}: ${def.modes.find((x) => x.id === next)?.label ?? next}`);
      }
      if (labels.length === 0) {
        state.notify(state.sel.machines.size > 1 ? tr('Không máy nào trong nhóm có chế độ để đổi') : tr('Máy này không có chế độ để đổi'));
        return;
      }
      state.setTool({ ...t, modes });
      updateGhost();
      state.notify(labels.length === 1 ? tr('Chế độ khi đặt — {0}', labels[0]) : tr('Đổi chế độ {0} máy khi đặt', labels.length));
      return;
    }
    // máy đang cầm: đặt mới (người dùng 2026-10-02), di chuyển hay sao chép — chế độ áp vào lúc đặt xuống
    if (t.kind === 'place') {
      const def = state.ds.machines.get(t.machineId);
      if (!def?.modes || def.modes.length < 2) {
        state.notify(tr('Máy này không có chế độ để đổi'));
        return;
      }
      const ids = def.modes.map((x) => x.id);
      const now = t.machineMode ?? 'A';
      const next = ids[(ids.indexOf(now) + 1) % ids.length]!;
      state.setTool({ ...t, machineMode: next });
      state.notify(tr('Chế độ khi đặt: {0}', def.modes.find((x) => x.id === next)?.label ?? next));
      return;
    }
    const uid = state.selection;
    if (uid === null || state.tool.kind !== 'select') return;
    const m = state.bp.machines.find((v) => v.uid === uid);
    const def = m ? state.ds.machines.get(m.machineId) : undefined;
    if (!def?.modes || def.modes.length < 2) {
      state.notify(tr('Máy này không có chế độ để đổi'));
      return;
    }
    state.mutate(tr('Đổi chế độ'), () => {
      const r = cycleMode(state.bp, state.ds, uid);
      const now = state.bp.machines.find((v) => v.uid === uid)?.mode ?? 'A';
      state.message = r.ok ? tr('Chế độ: {0}', def.modes!.find((x) => x.id === now)?.label ?? now) : (r.reason ?? tr('Không đổi được'));
    });
  };

  /** Ctrl+R: xoay khung nhìn 90° quanh tâm màn hình (chỉ đổi cách nhìn, bản vẽ không đổi). */
  const rotateCamera = (delta: number): void => {
    renderer.camera.rotateView(delta);
    state.viewTurns = renderer.camera.turns;
    if (lastMouse) updateHover(lastMouse);
    state.notify(tr('Xoay camera {0}° — Ctrl+R xoay tiếp, Ctrl+Shift+R xoay ngược', renderer.camera.turns * 90));
  };

  return {
    /**
     * Một khung hình: di chuyển camera theo phím đang giữ với **tốc độ cố định** trên màn
     * hình (không đổi theo zoom, không tăng dần), rồi cập nhật ô dưới con trỏ vì camera đã
     * trượt đi dưới nó. Trả về `true` nếu có gì thay đổi.
     */
    tick(dt: number): boolean {
      let vx = 0;
      let vy = 0;
      const now = performance.now();
      for (const [k, h] of held) {
        if (h.until !== null && now > h.until) {
          held.delete(k);
          continue;
        }
        vx += h.v[0];
        vy += h.v[1];
      }
      if (vx === 0 && vy === 0) return false;
      const len = Math.hypot(vx, vy); // đi chéo không nhanh hơn đi thẳng
      const step = PAN_SPEED * dt;
      renderer.camera.pan((-vx / len) * step, (-vy / len) * step);
      if (lastMouse) updateHover(lastMouse);
      return true;
    },
    refreshHover(): void {
      if (lastMouse) updateHover(lastMouse);
    },
    pointAt(cell: Cell | null): void {
      lock = null;
      renderer.hover = { cell, port: null };
      updateGhost();
      state.emit('view');
    },
    commitHere(): CommitResult {
      const tool = state.tool;
      const cell = renderer.hover.cell;
      if (tool.kind === 'place') {
        if (!cell) return { ok: false };
        return placeAt(cell);
      }
      if (tool.kind === 'group') {
        const target = renderer.groupTarget ?? cell;
        if (!target) return { ok: false };
        const out: { sel?: Selection; reason?: string } = {};
        const ok = dropGroup(state, renderer, target, out);
        return { ok, sel: out.sel, reason: out.reason };
      }
      if (tool.kind === 'stamp') {
        const target = renderer.groupTarget ?? cell;
        return { ok: !!target && dropStamp(state, target) };
      }
      return { ok: false };
    },
  };
}

/**
 * Sự kiện chuột **trình duyệt tự sinh từ một cú chạm** (app Android: chạm vào nút ⇒ mousemove / mousedown / mouseup giả
 * tại chỗ nút). Bản đồ bỏ qua chúng — trước đây chạm nút Xoay làm preview máy nhảy tới chỗ nút (người dùng 2026-10-05).
 * Cử chỉ trên bản đồ do `ui/touchMap.ts` tự phát sự kiện chuột riêng (không có `sourceCapabilities`) nên vẫn chạy.
 */
const fromTouch = (e: MouseEvent): boolean =>
  !!(e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } | null }).sourceCapabilities?.firesTouchEvents;

/** Tốc độ di chuyển camera bằng phím, pixel màn hình mỗi giây. */
const PAN_SPEED = 900;

export interface InputHandle {
  tick(dt: number): boolean;
  refreshHover(): void;
  /**
   * Cảm ứng (app Android, người dùng 2026-10-05): đặt "con trỏ" ở ô `cell` — preview máy / nhóm / bản vẽ đang cầm nằm
   * theo ô này; `null` = ẩn preview. Không bấm gì.
   */
  pointAt(cell: Cell | null): void;
  /**
   * Cảm ứng: bấm **Đặt** — đặt thứ đang cầm (máy mới / di chuyển / sao chép, nhóm, bản vẽ) tại preview hiện tại, đúng
   * đường xử lý của chuột trái. `sel` = vùng chọn mới sau khi đặt nhóm (bản sao vừa đặt).
   */
  commitHere(): CommitResult;
}

function applyTerrain(
  state: AppState,
  cell: Cell,
  paint: TerrainKind | 'clear',
  startStroke: boolean,
): void {
  const key = cellKey(cell);
  const apply = (): void => {
    if (paint === 'clear') delete state.terrain[key];
    else state.terrain[key] = paint;
  };
  // nét vẽ đầu tiên mới đẩy vào undo; các ô tiếp theo gộp vào cùng một bước
  if (startStroke) state.mutate(tr('Sơn địa hình'), apply);
  else {
    apply();
    state.emit();
  }
}

export type { Tool };
