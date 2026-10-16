import type { BeltTile, Blueprint, Cell, Dir4, Link } from '../model/types';
import type { Terrain } from '../grid/grid';
import { tr } from '../i18n';

export interface SavedPlan {
  format: 'endfield-planner';
  version: 1;
  blueprint: Blueprint;
  terrain: Terrain;
}

const MAGIC = 'EFP1';

export const toJson = (bp: Blueprint, terrain: Terrain): string =>
  JSON.stringify({ format: 'endfield-planner', version: 1, blueprint: bp, terrain } satisfies SavedPlan);

const dirOf = (a: Cell, b: Cell): Dir4 =>
  (b.z < a.z ? 0 : b.x > a.x ? 1 : b.z > a.z ? 2 : 3) as Dir4;

/**
 * Bản vẽ định dạng 1 lưu "tuyến nối cổng A tới cổng B" kèm đường đi. Định dạng 2 lưu
 * từng ô với hướng vào/ra. Đổi được mà không cần dữ liệu máy: hướng của mỗi ô suy từ
 * ô trước và ô sau nó trên đường đi; hai đầu thì giữ thẳng.
 */
function migrateLinks(links: Link[], nextUid: number): { belts: BeltTile[]; nextUid: number } {
  const belts: BeltTile[] = [];
  for (const l of links) {
    const p = l.path;
    if (p.length === 0) continue;
    const group = nextUid++;
    for (let i = 0; i < p.length; i++) {
      const prev = p[i - 1];
      const cur = p[i]!;
      const next = p[i + 1];
      const out: Dir4 = next ? dirOf(cur, next) : prev ? dirOf(prev, cur) : 2;
      const inn: Dir4 = prev ? dirOf(prev, cur) : out;
      belts.push({ x: cur.x, z: cur.z, kind: l.kind, in: inn, out, group });
    }
  }
  return { belts, nextUid };
}

export function fromJson(text: string): SavedPlan {
  const data = JSON.parse(text) as Partial<SavedPlan> & { blueprint?: Blueprint & { links?: Link[] } };
  if (data.format !== 'endfield-planner' || !data.blueprint)
    throw new Error(tr('Không phải file bản vẽ của ứng dụng này'));
  const bp = data.blueprint;
  if (!Array.isArray(bp.belts)) {
    const m = migrateLinks(bp.links ?? [], bp.nextUid ?? 1);
    bp.belts = m.belts;
    bp.nextUid = m.nextUid;
  }
  delete bp.links;
  bp.version = 2;
  return { format: 'endfield-planner', version: 1, blueprint: bp, terrain: data.terrain ?? {} };
}

/**
 * **Kiểm tra bản vẽ nhập từ ngoài** (file / mã chia sẻ — 2026-10-13): chỉ chặn dữ liệu hỏng rõ ràng (sai kiểu, toạ độ
 * không phải số, số lượng / kích thước vô lý) trước khi nó vào bộ giải và bộ vẽ. **Không** dùng cho dữ liệu của chính
 * ứng dụng (tab, bản tự lưu) để bản cũ của người dùng không bao giờ bị từ chối. Hỏng ⇒ ném lỗi có lời giải thích.
 */
const LIMIT = { coord: 10000, area: 2000, machines: 20000, tiles: 400000 };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (why: string): Error => new Error(tr('Bản vẽ bị hỏng: {0}', why));
function checkMachines(list: unknown): void {
  if (!Array.isArray(list)) throw bad(tr('thiếu danh sách máy'));
  if (list.length > LIMIT.machines) throw bad(tr('quá nhiều máy ({0})', list.length));
  for (const m of list) {
    if (!isObj(m) || typeof m.machineId !== 'string' || !finite(m.uid) || !finite(m.x) || !finite(m.z)) throw bad(tr('máy thiếu mã / toạ độ'));
    if (Math.abs(m.x) > LIMIT.coord || Math.abs(m.z) > LIMIT.coord) throw bad(tr('toạ độ máy quá xa'));
    if (m.rot !== undefined && m.rot !== 0 && m.rot !== 90 && m.rot !== 180 && m.rot !== 270) throw bad(tr('hướng máy không hợp lệ'));
  }
}
function checkTiles(list: unknown): void {
  if (!Array.isArray(list)) throw bad(tr('thiếu danh sách băng / ống'));
  if (list.length > LIMIT.tiles) throw bad(tr('quá nhiều ô băng / ống ({0})', list.length));
  for (const t of list) {
    if (!isObj(t) || !finite(t.x) || !finite(t.z)) throw bad(tr('ô băng / ống thiếu toạ độ'));
    if (Math.abs(t.x) > LIMIT.coord || Math.abs(t.z) > LIMIT.coord) throw bad(tr('toạ độ băng / ống quá xa'));
  }
}
/** Bản vẽ toàn map (đã qua `fromJson`). */
export function checkImportedBlueprint(bp: unknown): void {
  if (!isObj(bp)) throw bad(tr('không có bản vẽ'));
  if (bp.area !== undefined) {
    const a = bp.area;
    if (!isObj(a) || !finite(a.w) || !finite(a.d) || a.w <= 0 || a.d <= 0 || a.w > LIMIT.area || a.d > LIMIT.area) throw bad(tr('kích thước map không hợp lệ'));
  }
  checkMachines(bp.machines);
  checkTiles(bp.belts);
}
/** Một module (nhóm máy + ô băng / ống). */
export function checkImportedPieces(p: unknown): void {
  if (!isObj(p)) throw bad(tr('không có nhóm máy'));
  checkMachines(p.machines);
  checkTiles(p.tiles);
}
/** Một sơ đồ Modeler. */
export function checkImportedModeler(doc: unknown): void {
  if (!isObj(doc) || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw bad(tr('sơ đồ Modeler thiếu nút / đường nối'));
  for (const n of doc.nodes) if (!isObj(n) || typeof n.id !== 'string' || typeof n.machineId !== 'string' || !finite(n.x) || !finite(n.y)) throw bad(tr('nút Modeler không hợp lệ'));
  for (const e of doc.edges) if (!isObj(e) || !isObj(e.from) || !isObj(e.to)) throw bad(tr('đường nối Modeler không hợp lệ'));
}

const b64encode = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64decode = (text: string): Uint8Array => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Mã chia sẻ: `EFP1` + deflate + base64url. Nén vì đường đi của tuyến chiếm phần
 * lớn dung lượng và nó rất dễ nén.
 */
export async function toShareCode(bp: Blueprint, terrain: Terrain): Promise<string> {
  const raw = new TextEncoder().encode(toJson(bp, terrain));
  return MAGIC + b64encode(await deflate(raw));
}

export async function fromShareCode(code: string): Promise<SavedPlan> {
  const trimmed = code.trim();
  if (!trimmed.startsWith(MAGIC)) throw new Error(tr('Mã phải bắt đầu bằng {0}', MAGIC));
  const raw = await inflate(b64decode(trimmed.slice(MAGIC.length)));
  const plan = fromJson(new TextDecoder().decode(raw));
  checkImportedBlueprint(plan.blueprint);
  return plan;
}
