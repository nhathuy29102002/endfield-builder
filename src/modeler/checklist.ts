import type { Dataset, RecipeDef } from '../model/types';
import { computeModeler, type ModelerCalc } from './calc';
import { kindOfNode, recipeOf, type MNode, type ModelerDoc } from './doc';

/**
 * **Checklist dây chuyền** (người dùng 2026-10-12): gom mọi máy của một sơ đồ Modeler thành danh sách cần xây, mỗi dòng
 * = một **loại máy + công thức** (`<số>x [môi trường | máy | vào → ra]`), kèm các **dòng con** — từng nút của sơ đồ dùng
 * công thức đó và **đường đi** của hàng nó làm ra tới sản phẩm cuối (vd. 3 nút "Tinh luyện đồng thô" cho 3 nhánh khác
 * nhau của Linh kiện nham đồng ⇒ 3 dòng con 4x / 1x / 2x).
 *  - Lấy **mọi máy trừ điểm cuối** (kho / máy xử lý — `sink`); máy nguồn (dỡ hàng kho, bơm…) vẫn tính.
 *  - Số máy: làm tròn lên **từng nút**; dòng chính = tổng các nút.
 *  - Một nút cấp hàng cho nhiều nơi ⇒ mỗi nơi một dòng con, số máy chia theo lưu lượng (tổng = số máy của nút, nhánh nhỏ
 *    có thể 0 máy); đoạn nối ngay sau nút đó tô **cùng một màu** ở mọi dòng con của nó (`fork`).
 *  - Thứ tự: máy càng gần đầu chuỗi càng lên trên (`depth`).
 * Trạng thái tích / ghim lưu trong chính sơ đồ (`doc.checks`, `doc.checkPins`).
 */

/** Một bước trên đường đi: hàng `item` chạy từ nút trước sang nút `node` (máy làm ra món kế tiếp). */
export interface PathStep {
  item: string;
  /** Nút nhận hàng; `null` ở bước cuối khi hàng vào kho / máy xử lý (điểm cuối). */
  node: string | null;
}

export interface CheckSub {
  /** Khoá ổn định của dòng con (nút + các nút trên đường đi). */
  key: string;
  node: string;
  count: number;
  /** Hàng đi từ nút này tới sản phẩm cuối. Bước cuối cùng = sản phẩm cuối. */
  path: PathStep[];
  /** Nút này cấp cho nhiều nơi ⇒ chỉ số màu của đoạn nối đầu tiên (cùng nút ⇒ cùng màu). */
  fork: number | null;
}

export interface CheckRow {
  /** Khoá ổn định của dòng chính: máy + công thức / vật phẩm. */
  key: string;
  machineId: string;
  recipe: RecipeDef | null;
  /** Máy nguồn / máy khuếch tán: vật phẩm lấy ra / khí nhận. */
  item?: string;
  count: number;
  /** Số bước từ đầu chuỗi (nguồn = 0). */
  depth: number;
  subs: CheckSub[];
}

const MAX_PATHS = 12;

/** Khoá dòng chính của một nút (cùng máy + cùng công thức ⇒ cùng dòng). */
export const rowKey = (n: MNode): string => `${n.machineId}|${n.recipeId ?? n.ticks?.join('+') ?? ''}|${n.item ?? ''}`;

/** Công thức hiển thị của nút: công thức thường, hoặc công thức đầu tiên được tick của lò phản ứng. */
const recipeFor = (ds: Dataset, n: MNode): RecipeDef | null => recipeOf(ds, n) ?? (n.ticks?.[0] ? (ds.recipes.get(n.ticks[0]) ?? null) : null);

export function buildChecklist(ds: Dataset, doc: ModelerDoc, calc: ModelerCalc = computeModeler(ds, doc)): CheckRow[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const outs = new Map<string, { to: string; item: string; flow: number }[]>();
  const ins = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (!byId.has(e.from.node) || !byId.has(e.to.node) || e.from.node === e.to.node) continue;
    const list = outs.get(e.from.node) ?? [];
    list.push({ to: e.to.node, item: e.from.item, flow: calc.edges.get(e.id) ?? 0 });
    outs.set(e.from.node, list);
    ins.set(e.to.node, [...(ins.get(e.to.node) ?? []), e.from.node]);
  }
  const sink = (id: string): boolean => {
    const n = byId.get(id);
    return !!n && kindOfNode(ds, n) === 'sink';
  };

  // số bước từ đầu chuỗi: dài nhất theo đường nối ngược (vòng ⇒ dừng)
  const depthMemo = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const known = depthMemo.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(-1, ...(ins.get(id) ?? []).map((p) => depthOf(p, seen))) + 1;
    seen.delete(id);
    depthMemo.set(id, d);
    return d;
  };

  /** Sản phẩm chính của một nút (công thức: sản phẩm đầu; máy nguồn: vật phẩm lấy ra). */
  const mainOutput = (n: MNode): string | null => recipeFor(ds, n)?.outcomes[0]?.itemId ?? n.item ?? null;
  /** Mọi đường đi từ nút `id` tới điểm cuối, kèm phần lưu lượng (0…1) của nút đi theo đường đó. */
  const pathsFrom = (id: string): { steps: PathStep[]; share: number }[] => {
    const found: { steps: PathStep[]; share: number }[] = [];
    const walk = (at: string, steps: PathStep[], share: number, seen: Set<string>): void => {
      if (found.length >= MAX_PATHS) return;
      const list = outs.get(at) ?? [];
      if (list.length === 0) {
        // máy cuối không nối ra đâu (Mô hình hoá không đặt kho ở cuối) ⇒ sản phẩm của nó là điểm cuối
        const end = at !== id ? mainOutput(byId.get(at)!) : null;
        found.push({ steps: end ? [...steps, { item: end, node: null }] : steps, share });
        return;
      }
      const total = list.reduce((a, o) => a + o.flow, 0);
      for (const o of list) {
        const part = total > 1e-9 ? o.flow / total : 1 / list.length;
        const step: PathStep = { item: o.item, node: sink(o.to) ? null : o.to };
        if (step.node === null || seen.has(o.to)) found.push({ steps: [...steps, step], share: share * part });
        else walk(o.to, [...steps, step], share * part, new Set(seen).add(o.to));
        if (found.length >= MAX_PATHS) return;
      }
    };
    walk(id, [], 1, new Set([id]));
    return found;
  };

  const rows = new Map<string, CheckRow>();
  let forks = 0;
  for (const n of doc.nodes) {
    const kind = kindOfNode(ds, n);
    if (kind === 'sink') continue;
    const c = calc.nodes.get(n.id);
    const want = c?.target ?? c?.actual ?? 0;
    const count = want > 1e-6 ? Math.ceil(want - 1e-9) : 0;
    const paths = pathsFrom(n.id);
    const fork = paths.length > 1 ? forks++ : null;
    const key = rowKey(n);
    let row = rows.get(key);
    if (!row) {
      row = { key, machineId: n.machineId, recipe: recipeFor(ds, n), item: n.item, count: 0, depth: Infinity, subs: [] };
      rows.set(key, row);
    }
    row.count += count;
    row.depth = Math.min(row.depth, depthOf(n.id, new Set()));
    const list = paths.length ? paths : [{ steps: [], share: 1 }];
    // chia số máy của nút cho các nhánh theo lưu lượng, **tổng đúng bằng số máy thật** (phần dư cho nhánh lẻ nhiều nhất)
    const raw = list.map((p) => count * p.share);
    const split = raw.map(Math.floor);
    let rest = count - split.reduce((a, v) => a + v, 0);
    for (const i of raw.map((v, i) => i).sort((a, b) => raw[b]! - Math.floor(raw[b]!) - (raw[a]! - Math.floor(raw[a]!)))) {
      if (rest <= 0) break;
      split[i]!++;
      rest--;
    }
    list.forEach((p, i) =>
      row!.subs.push({ key: [n.id, ...p.steps.map((s) => s.node ?? `>${s.item}`)].join('/'), node: n.id, count: split[i]!, path: p.steps, fork }),
    );
  }
  return [...rows.values()].sort((a, b) => a.depth - b.depth);
}

/** Số máy đã xây theo khoá dòng con (`doc.built`); sơ đồ cũ còn `doc.checks` (đã tích = xây đủ) thì đọc như xây đủ. */
export type Built = Record<string, number>;
export function builtOf(rows: CheckRow[], doc: ModelerDoc): Built {
  const b: Built = { ...(doc.built ?? {}) };
  if (doc.checks?.length) {
    const old = new Set(doc.checks);
    for (const r of rows) for (const sub of r.subs) if (old.has(sub.key) && b[sub.key] === undefined) b[sub.key] = sub.count;
  }
  return b;
}
/** Số máy còn phải xây của một dòng con / một dòng chính. */
export const subLeft = (sub: CheckSub, built: Built): number => Math.max(0, sub.count - (built[sub.key] ?? 0));
export const rowLeft = (row: CheckRow, built: Built): number => row.subs.reduce((a, sub) => a + subLeft(sub, built), 0);
/** Dòng chính đã xây xong (mọi dòng con đủ máy). Dòng 0 máy (chưa tính được) không bao giờ "xong". */
export const rowDone = (row: CheckRow, built: Built): boolean => row.count > 0 && rowLeft(row, built) === 0;
/**
 * Ô tích hình thoi (người dùng 2026-10-12, lần 2): **trừ một máy** — vào dòng con đầu tiên còn thiếu theo thứ tự ưu tiên
 * (thứ tự dòng con). Trả về khoá dòng con vừa trừ, `null` nếu đã đủ.
 */
export function tickOne(row: CheckRow, built: Built): string | null {
  const sub = row.subs.find((x) => subLeft(x, built) > 0);
  if (!sub) return null;
  built[sub.key] = (built[sub.key] ?? 0) + 1;
  return sub.key;
}
/** Bỏ một máy đã xây (dòng con cuối cùng có máy đã xây). */
export function untickOne(row: CheckRow, built: Built): void {
  const sub = [...row.subs].reverse().find((x) => (built[x.key] ?? 0) > 0);
  if (sub) built[sub.key] = Math.max(0, (built[sub.key] ?? 0) - 1);
}
/** Bấm vào thẻ công thức: xây xong toàn bộ (`on`) hoặc bỏ hết. */
export function setRowBuilt(subs: CheckSub[], built: Built, on: boolean): void {
  for (const x of subs) built[x.key] = on ? x.count : 0;
}

/**
 * Thứ tự hiển thị (người dùng 2026-10-12): **chưa xong** trước, đã xong (làm tối) dồn xuống cuối; trong mỗi phần dòng
 * **ghim** lên đầu, rồi máy **đầu chuỗi** trước máy cuối chuỗi.
 */
export function orderRows(rows: CheckRow[], built: Built, pins: ReadonlySet<string>): CheckRow[] {
  return rows
    .map((r, i) => ({ r, i, done: rowDone(r, built) ? 1 : 0, pin: pins.has(r.key) ? 0 : 1 }))
    .sort((a, b) => a.done - b.done || a.pin - b.pin || a.r.depth - b.r.depth || a.i - b.i)
    .map((x) => x.r);
}
