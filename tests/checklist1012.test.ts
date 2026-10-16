import { describe, expect, it } from 'vitest';
import { buildChain } from '../src/model/recipeBook';
import { chainToModeler } from '../src/modeler/fromChain';
import { buildChecklist, orderRows, rowDone, rowLeft, setRowBuilt, tickOne, type Built } from '../src/modeler/checklist';
import { computeModeler } from '../src/modeler/calc';
import { emptyModeler, kindOfNode, type MEdge, type MNode } from '../src/modeler/doc';
import { ds } from './helpers';

/** Checklist dây chuyền (người dùng 2026-10-12). */
const FINAL = 'item_equip_script_4_3'; // Linh Kiện Nham Đồng

describe('checklist từ chuỗi Linh Kiện Nham Đồng', () => {
  const doc = chainToModeler(ds, buildChain(ds, FINAL));
  // máy cuối: 2 máy ⇒ cả dây chuyền có số máy
  const last = doc.nodes.find((n) => n.recipeId && ds.recipes.get(n.recipeId)?.outcomes.some((o) => o.itemId === FINAL));
  last!.limit = 2;
  const calc = computeModeler(ds, doc);
  const rows = buildChecklist(ds, doc, calc);

  it('không có điểm cuối (kho / máy xử lý), có máy nguồn', () => {
    const kinds = rows.flatMap((r) => r.subs.map((s) => kindOfNode(ds, doc.nodes.find((n) => n.id === s.node)!)));
    expect(kinds).not.toContain('sink');
    expect(kinds).toContain('source');
  });

  it('dòng chính = tổng số máy (làm tròn lên từng nút) của mọi nút cùng máy + công thức', () => {
    for (const r of rows) {
      const nodes = doc.nodes.filter((n) => r.subs.some((s) => s.node === n.id));
      const sum = [...new Set(nodes)].reduce((a, n) => {
        const c = calc.nodes.get(n.id);
        const t = c?.target ?? c?.actual ?? 0;
        return a + (t > 1e-6 ? Math.ceil(t - 1e-9) : 0);
      }, 0);
      expect(r.count).toBe(sum);
    }
  });

  it('công thức dùng ở nhiều nhánh ⇒ nhiều dòng con, mỗi dòng đi tới sản phẩm cuối', () => {
    const multi = rows.find((r) => new Set(r.subs.map((s) => s.node)).size > 1);
    expect(multi).toBeTruthy();
    for (const s of multi!.subs) expect(s.path.at(-1)?.item).toBe(FINAL);
  });

  it('máy đầu chuỗi xếp trước; dòng xây xong dồn xuống cuối, dòng ghim lên đầu phần chưa xong', () => {
    const order = orderRows(rows, {}, new Set());
    expect(order[0]!.depth).toBe(0);
    const first = order[0]!;
    const built: Built = {};
    setRowBuilt(first.subs, built, true);
    expect(orderRows(rows, built, new Set()).at(-1)).toBe(first);
    const pinned = order.at(-1)!;
    expect(orderRows(rows, {}, new Set([pinned.key]))[0]).toBe(pinned);
  });

  it('ô hình thoi trừ từng máy theo thứ tự dòng con; đủ thì xong', () => {
    const row = rows.find((r) => r.subs.length > 1 && r.count > 1)!;
    const built: Built = {};
    const k = tickOne(row, built);
    expect(k).toBe(row.subs[0]!.key);
    expect(rowLeft(row, built)).toBe(row.count - 1);
    for (let i = 1; i < row.count; i++) tickOne(row, built);
    expect(rowDone(row, built)).toBe(true);
    expect(tickOne(row, built)).toBeNull();
  });
});

describe('một nút cấp cho hai nơi ⇒ hai dòng con cùng màu, chia số máy theo lưu lượng', () => {
  const n = (id: string, machineId: string, extra: Partial<MNode> = {}): MNode => ({ id, machineId, recipeId: null, x: 0, y: 0, limit: null, ...extra });
  const e = (id: string, from: string, to: string, item: string): MEdge => ({ id, from: { node: from, item }, to: { node: to, item } });
  const GAS = 'item_gas_xiranite';
  const POW = 'item_xiranite_powder';
  const R_GAS = 'liquid_transmuter_2_gas_gas_xiranite_1';
  const doc = {
    ...emptyModeler(),
    nodes: [
      n('u', 'unloader_1', { item: POW }),
      n('t1', 'transmuter_2', { recipeId: R_GAS, limit: 1 }),
      n('t2', 'transmuter_2', { recipeId: R_GAS, limit: 1 }),
      n('s1', 'gas_storager_1'),
      n('s2', 'gas_storager_1'),
    ],
    edges: [e('a', 'u', 't1', POW), e('b', 'u', 't2', POW), e('c', 't1', 's1', GAS), e('d', 't2', 's2', GAS)],
  };
  const rows = buildChecklist(ds, doc);
  it('máy dỡ hàng kho: hai dòng con, cùng chỉ số màu, tổng số máy = số máy của nút', () => {
    const src = rows.find((r) => r.machineId === 'unloader_1')!;
    expect(src.subs).toHaveLength(2);
    expect(src.subs.reduce((a, x) => a + x.count, 0)).toBe(src.count);
    expect(src.subs[0]!.fork).not.toBeNull();
    expect(src.subs[0]!.fork).toBe(src.subs[1]!.fork);
  });
  it('hai máy chế biến cùng công thức gộp một dòng, hai dòng con', () => {
    const t = rows.find((r) => r.machineId === 'transmuter_2')!;
    expect(t.subs.map((s) => s.node).sort()).toEqual(['t1', 't2']);
    expect(t.count).toBe(2);
    expect(t.subs.every((s) => s.fork === null && s.path.at(-1)?.node === null)).toBe(true);
  });
});
