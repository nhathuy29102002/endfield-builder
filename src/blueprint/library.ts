import type { Terrain } from '../grid/grid';
import { footprintCells } from '../model/geometry';
import type { Blueprint, Dataset } from '../model/types';
import { selectionPieces, type Pieces, type Selection } from '../editor/group';
import { checkImportedBlueprint, checkImportedModeler, checkImportedPieces, fromJson } from './serialize';
import type { ModelerDoc } from '../modeler/doc';
import { tr } from '../i18n';
import { requestPersistentStorage } from '../storageGuard';

/**
 * Thư viện bản vẽ đã lưu.
 *
 * - `map`    — **toàn bộ** bản vẽ (kèm địa hình). Đặt nó = thay cả map hiện tại.
 * - `module` — một **nhóm** vật thể đã chọn, dời về gốc (0,0). Đặt nó = preview theo con
 *   trỏ rồi bấm để đặt, như sao chép nhóm.
 * - `modeler` — một **sơ đồ Modeler** (Modeler đợt 4, người dùng 2026-09-29). Mở = một tab Modeler mới.
 *
 * Lưu trong `localStorage` của trình duyệt (mỗi trình duyệt một thư viện riêng); muốn
 * mang sang máy khác thì Xuất ra file rồi Nhập lại.
 */
export interface SavedBlueprint {
  id: string;
  name: string;
  /** Id vật tư làm biểu tượng; `null` = chưa chọn. */
  icon: string | null;
  kind: 'map' | 'module' | 'modeler';
  created: number;
  /** Ảnh xem trước, dataURL JPEG nhỏ. */
  preview: string;
  map?: { blueprint: Blueprint; terrain: Terrain };
  module?: Pieces;
  modeler?: ModelerDoc;
}

const KEY = 'efp:library';
export const LIBRARY_FORMAT = 'efp-library';

/**
 * **Kho IndexedDB** (2026-10-13): thư viện (có ảnh xem trước dataURL) dễ vượt hạn ~5 MB của `localStorage` — mà
 * `localStorage` còn phải chứa các tab đang mở. Nên thư viện chuyển sang IndexedDB (hạn mức lớn hơn nhiều):
 *  - `initLibraryStore()` (gọi một lần ở `main.ts` trước khi dựng giao diện) mở CSDL `efp`, kho `kv`, khoá `library`,
 *    đọc cả danh sách vào bộ nhớ. Lần đầu: chép từ `localStorage` sang, **đọc lại kiểm tra đủ** rồi mới xoá bản cũ.
 *    Cả hai nơi cùng có dữ liệu (vd. lỡ chạy bản app cũ sau khi đã chuyển) ⇒ gộp theo id, không mất bản vẽ nào.
 *  - `loadLibrary()` / `saveLibrary()` vẫn **đồng bộ** như cũ (mọi chỗ gọi giữ nguyên): đọc = bản sao của bộ nhớ;
 *    ghi = cập nhật bộ nhớ ngay, ghi xuống IndexedDB ở nền, **lần lượt** theo thứ tự lưu. Ghi lỗi (hết chỗ…) ⇒ phát
 *    `LIBRARY_ERROR_EVENT` (main.ts báo bằng toast) thay vì ném lỗi như trước.
 *  - Không có IndexedDB (môi trường test, trình duyệt chặn), mở lỗi hay quá 3 s ⇒ chạy y như cũ bằng `localStorage`.
 */
const DB_NAME = 'efp';
const STORE = 'kv';
const DB_KEY = 'library';
/** Đang dùng IndexedDB: danh sách trong bộ nhớ + CSDL. `null` ⇒ dùng `localStorage` như cũ. */
let cache: SavedBlueprint[] | null = null;
let db: IDBDatabase | null = null;
/** Chuỗi ghi nền — mỗi lần lưu nối vào sau lần trước (không ghi đè lẫn nhau). */
let writing: Promise<void> = Promise.resolve();
/** Ghi thư viện xuống IndexedDB thất bại: `detail` = lời nhắn cho người dùng. */
export const LIBRARY_ERROR_EVENT = 'efp:library-error';

/**
 * **Nhiều cửa sổ trình duyệt** (rà soát 2026-10-14): mỗi cửa sổ giữ một bản thư viện trong bộ nhớ rồi ghi **cả danh
 * sách** xuống ⇒ trước đây bản vẽ vừa lưu ở cửa sổ A bị cửa sổ B (bản cũ) ghi đè mất. Nay: ghi xong thì báo qua
 * `BroadcastChannel`; cửa sổ khác (đợi các lần ghi của chính nó xong) đọc lại CSDL vào bộ nhớ rồi phát `LIBRARY_EVENT`
 * để giao diện vẽ lại. Kiểu `localStorage` (không có IndexedDB): sự kiện `storage` của trình duyệt.
 */
let channel: BroadcastChannel | null = null;
const announce = (): void => {
  try {
    channel?.postMessage('changed');
  } catch {
    /* kênh đã đóng */
  }
};
const listenOtherWindows = (): void => {
  if (typeof window === 'undefined') return;
  if (typeof BroadcastChannel !== 'undefined' && !channel) {
    channel = new BroadcastChannel('efp-library');
    channel.onmessage = () => {
      const d = db;
      if (!d || !cache) return;
      writing = writing
        .then(async () => {
          const v = await idbGet(d, DB_KEY);
          if (Array.isArray(v)) {
            cache = v as SavedBlueprint[];
            window.dispatchEvent(new Event(LIBRARY_EVENT));
          }
        })
        .catch((err: unknown) => console.warn('[library] đọc lại thư viện lỗi:', err));
    };
  }
};
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && !cache) window.dispatchEvent(new Event(LIBRARY_EVENT));
  });

const readLocal = (): SavedBlueprint[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedBlueprint[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('indexedDB.open'));
    r.onblocked = () => reject(new Error('indexedDB blocked'));
  });
const idbGet = (d: IDBDatabase, key: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('get'));
  });
/** Ghi xong khi giao dịch **hoàn tất** (`oncomplete`), không chỉ khi lệnh put thành công. */
const idbWrite = (d: IDBDatabase, key: string, value: unknown | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    if (value === undefined) os.delete(key);
    else os.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('write'));
    tx.onabort = () => reject(tx.error ?? new Error('abort'));
  });

/** Mở kho IndexedDB (một lần, trước khi dựng giao diện). Lỗi / quá `timeoutMs` ⇒ lặng lẽ dùng `localStorage`. */
export async function initLibraryStore(timeoutMs = 3000): Promise<void> {
  if (cache || typeof indexedDB === 'undefined' || typeof localStorage === 'undefined') return;
  let abandoned = false;
  const work = (async () => {
    const d = await openDb();
    const stored = await idbGet(d, DB_KEY);
    const local = localStorage.getItem(KEY) !== null ? readLocal() : null;
    let list: SavedBlueprint[] = Array.isArray(stored) ? (stored as SavedBlueprint[]) : [];
    let changed = !Array.isArray(stored);
    if (local) {
      // gộp: bản vẽ chỉ có ở localStorage thì thêm vào (bản trùng id giữ bản trong IndexedDB)
      const have = new Set(list.map((b) => b.id));
      const extra = local.filter((b) => b && typeof b.id === 'string' && !have.has(b.id));
      if (extra.length) {
        list = [...list, ...extra];
        changed = true;
      }
    }
    if (changed) {
      await idbWrite(d, DB_KEY, list);
      const back = await idbGet(d, DB_KEY);
      if (!Array.isArray(back) || back.length !== list.length) throw new Error('verify');
    }
    return { d, list, migrated: changed, hadLocal: local !== null };
  })();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
  try {
    const r = await Promise.race([work, timeout]);
    db = r.d;
    cache = r.list;
    listenOtherWindows();
    // đã nằm an toàn trong IndexedDB (đọc lại đủ) ⇒ bỏ bản cũ, trả chỗ cho các tab đang mở
    if (r.hadLocal)
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* không xoá được thì thôi — lần sau gộp lại, không mất gì */
      }
  } catch (err) {
    abandoned = true;
    db = null;
    cache = null;
    console.warn('[library] IndexedDB không dùng được, dùng localStorage:', err);
    // chép dở mà đã bỏ (quá giờ): xoá bản vừa chép để lần sau chép lại từ localStorage (bản mới nhất của phiên này)
    void work
      .then((r) => (abandoned && r.migrated ? idbWrite(r.d, DB_KEY, undefined) : undefined))
      .catch(() => undefined);
  }
}

/** Đang lưu thư viện bằng IndexedDB (không phải localStorage). */
export const libraryUsesIndexedDb = (): boolean => cache !== null;
/** Đợi các lần ghi nền xong (test / trước khi đọc thẳng CSDL). */
export const libraryWritesSettled = (): Promise<void> => writing;

export function loadLibrary(): SavedBlueprint[] {
  // bản sao — nơi gọi được sửa thoải mái, chỉ `saveLibrary` mới đổi dữ liệu thật (như trước: mỗi lần đọc là một bản mới)
  if (cache) return structuredClone(cache);
  return readLocal();
}

/** Ghi thư viện. `localStorage` hết chỗ thì ném lỗi có lời giải thích; IndexedDB lỗi thì phát `LIBRARY_ERROR_EVENT`. */
export function saveLibrary(list: SavedBlueprint[]): void {
  requestPersistentStorage();
  if (cache && db) {
    const snapshot = structuredClone(list);
    cache = snapshot;
    const d = db;
    writing = writing
      .then(() => idbWrite(d, DB_KEY, snapshot))
      .then(announce)
      .catch((err: unknown) => {
        console.warn('[library] ghi IndexedDB lỗi:', err);
        if (typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent(LIBRARY_ERROR_EVENT, { detail: tr('Không lưu được thư viện bản vẽ — bộ nhớ của trình duyệt có thể đã đầy. Hãy Xuất bớt bản vẽ ra file.') }));
      });
  } else
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      throw new Error(tr('Trình duyệt hết chỗ lưu — hãy Xuất bớt bản vẽ ra file rồi xoá khỏi thư viện'));
    }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIBRARY_EVENT));
}
/** Thư viện vừa được ghi (bảng chọn máy đọc lại bản vẽ ghim). */
export const LIBRARY_EVENT = 'efp:library';
/** Bấm / kéo một bản vẽ ghim trên thanh đặt máy thu gọn: `detail` = id bản vẽ (`main.ts` ⇒ `useBlueprint`). */
export const USE_BLUEPRINT_EVENT = 'efp:use-blueprint';

/**
 * **Bản vẽ ghim lên thanh đặt máy thu gọn** (người dùng 2026-10-02): id các bản vẽ, theo thứ tự ghim. Mỗi trình
 * duyệt một danh sách; đổi xong phát `BP_PINS_EVENT` để bảng chọn máy vẽ lại.
 */
const PINS_KEY = 'efp:bp-pins';
export const BP_PINS_EVENT = 'efp:bp-pins';
export function loadBlueprintPins(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PINS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function setBlueprintPinned(id: string, on: boolean): void {
  const pins = loadBlueprintPins().filter((x) => x !== id);
  if (on) pins.push(id);
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* không lưu được thì thôi */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BP_PINS_EVENT));
}

export const newId = (): string => `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Tách nhóm đang chọn thành một module: chép sâu rồi dời sao cho ô nhỏ nhất của nhóm
 * nằm ở (0,0). Cặp ống ngầm trỏ ra ngoài nhóm thì bỏ (đầu kia không đi theo).
 */
export function moduleFromSelection(bp: Blueprint, ds: Dataset, sel: Selection): Pieces {
  const src = selectionPieces(bp, sel);
  const copy = JSON.parse(JSON.stringify(src)) as Pieces;
  let x0 = Infinity;
  let z0 = Infinity;
  for (const m of copy.machines) {
    const def = ds.machines.get(m.machineId);
    for (const c of def ? footprintCells(m, def) : [m]) {
      x0 = Math.min(x0, c.x);
      z0 = Math.min(z0, c.z);
    }
  }
  for (const t of copy.tiles) {
    x0 = Math.min(x0, t.x);
    z0 = Math.min(z0, t.z);
  }
  if (x0 === Infinity) return copy;
  const uids = new Set(copy.machines.map((m) => m.uid));
  for (const m of copy.machines) {
    m.x -= x0;
    m.z -= z0;
    if (m.pairTarget !== undefined && m.pairTarget !== null && !uids.has(m.pairTarget)) m.pairTarget = null;
  }
  for (const t of copy.tiles) {
    t.x -= x0;
    t.z -= z0;
  }
  return copy;
}

/** Hộp bao của một module (đã dời về gốc). */
export function piecesSize(ds: Dataset, p: Pieces): { w: number; d: number } {
  let w = 0;
  let d = 0;
  for (const m of p.machines) {
    const def = ds.machines.get(m.machineId);
    for (const c of def ? footprintCells(m, def) : [m]) {
      w = Math.max(w, c.x + 1);
      d = Math.max(d, c.z + 1);
    }
  }
  for (const t of p.tiles) {
    w = Math.max(w, t.x + 1);
    d = Math.max(d, t.z + 1);
  }
  return { w, d };
}

/**
 * Diện tích **thu gọn nhất** của một bản vẽ: hộp bao sát các máy và ô băng/ống bên
 * trong — không phải khung người dùng kéo, cũng không phải cả khu 70×70.
 */
export function savedSize(ds: Dataset, b: SavedBlueprint): { w: number; d: number } {
  if (b.module) return piecesSize(ds, b.module);
  const bp = b.map?.blueprint;
  if (!bp) return { w: 0, d: 0 };
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const add = (x: number, z: number): void => {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  };
  for (const m of bp.machines) {
    const def = ds.machines.get(m.machineId);
    for (const c of def ? footprintCells(m, def) : [m]) add(c.x, c.z);
  }
  for (const t of bp.belts) add(t.x, t.z);
  return x0 === Infinity ? { w: 0, d: 0 } : { w: x1 - x0 + 1, d: z1 - z0 + 1 };
}

/** Nội dung file xuất: một hoặc nhiều bản vẽ. */
export function exportLibrary(list: SavedBlueprint[]): string {
  return JSON.stringify({ format: LIBRARY_FORMAT, version: 1, blueprints: list }, null, 1);
}

/**
 * Đọc file nhập. Nhận file thư viện của ứng dụng này, hoặc file bản vẽ `.json` kiểu cũ
 * (nút "Lưu ra file" trước đây) — cái sau thành một bản vẽ toàn map. Mọi bản vẽ nhập vào
 * đều nhận `id` mới để không đè lên bản đang có.
 */
export function importFile(text: string, fileName: string): SavedBlueprint[] {
  const data = JSON.parse(text) as { format?: string; blueprints?: SavedBlueprint[] };
  if (data.format === LIBRARY_FORMAT && Array.isArray(data.blueprints)) {
    // từng bản vẽ: đúng loại + đúng cấu trúc (2026-10-13); bản hỏng bỏ qua, hỏng hết thì báo lỗi của bản đầu tiên
    let firstErr: Error | null = null;
    const ok = data.blueprints.filter((b) => {
      try {
        if (!b || typeof b !== 'object' || !(b.kind === 'map' ? b.map : b.kind === 'modeler' ? b.modeler : b.module)) return false;
        if (b.kind === 'map') checkImportedBlueprint(b.map!.blueprint);
        else if (b.kind === 'modeler') checkImportedModeler(b.modeler);
        else checkImportedPieces(b.module);
        return true;
      } catch (err) {
        firstErr ??= err as Error;
        return false;
      }
    });
    if (ok.length === 0 && firstErr) throw firstErr;
    return ok.map((b) => ({ ...b, name: typeof b.name === 'string' ? b.name : '', id: newId() }));
  }
  const plan = fromJson(text);
  checkImportedBlueprint(plan.blueprint);
  return [
    {
      id: newId(),
      name: plan.blueprint.name || fileName.replace(/\.json$/i, ''),
      icon: null,
      kind: 'map',
      created: Date.now(),
      preview: '',
      map: { blueprint: plan.blueprint, terrain: plan.terrain },
    },
  ];
}
