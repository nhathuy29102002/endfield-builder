import { describe, expect, it } from 'vitest';
import { removeBeltGroup, setRecipe } from '../src/editor/ops';
import { solve } from '../src/sim/solver';
import { createSimulation } from '../src/simulation/engine';
import { computeModeler } from '../src/modeler/calc';
import { emptyModeler, type MEdge, type MNode } from '../src/modeler/doc';
import { ds, paint, put, scene, source, wire } from './helpers';

/**
 * **Đối chiếu ba bộ tính** (rà soát 2026-10-14): bộ giải của Map (`sim/solver.ts`), phép tính của Modeler
 * (`modeler/calc.ts`) và bộ mô phỏng theo thời gian (`simulation/engine.ts`) cài đặt cùng một bộ luật ba lần. Cùng một
 * dây chuyền thì ba bên phải ra cùng lưu lượng: Map & Modeler khớp chính xác; mô phỏng chạy 1 giờ khớp trong ~2 %
 * (thời gian khởi động, hàng còn trên băng).
 *
 * Dây chuyền: nguồn Bột Rêu Đặc → lò A (→ Bột Carbon Đặc, 30/phút) → lò B (→ Carbon Đặc, 30/phút) → kho.
 */
const MOSS = 'item_plant_moss_enr_powder_1';
const POWDER = 'item_carbon_enr_powder';
const CARBON = 'item_carbon_enr';
const R_POWDER = 'furnance_carbon_enr_powder_1';
const R_CARBON = 'furnance_carbon_enr_1';

/** Map: mỏ (khai báo `rate`/phút) → lò A → lò B → kho. */
function mapChain(rate: number) {
  const s = scene(40, 40);
  paint(s.terrain, 'mine', 9, 29, 5, 5);
  const mine = put(s, 'miner_1', 10, 30);
  const a = put(s, 'furnance_1', 10, 24);
  const b = put(s, 'furnance_1', 10, 18);
  const store = put(s, 'storager_1', 10, 12);
  source(s, mine, MOSS, rate);
  setRecipe(s.bp, ds, a, R_POWDER);
  setRecipe(s.bp, ds, b, R_CARBON);
  wire(s, mine, 0, a, 0);
  wire(s, a, 0, b, 0);
  const out = wire(s, b, 0, store, 0);
  return { s, a, b, out };
}

/** Modeler: máy dỡ kho (`limit` tuyến, mỗi tuyến 30/phút; `null` = vô hạn) → lò A → lò B (`bLimit` máy). */
function modelerChain(srcLimit: number | null, bLimit: number | null) {
  const n = (id: string, machineId: string, recipeId: string | null, limit: number | null, item?: string): MNode => ({ id, machineId, recipeId, item, x: 0, y: 0, limit });
  const e = (id: string, from: string, to: string, item: string): MEdge => ({ id, from: { node: from, item }, to: { node: to, item } });
  return computeModeler(ds, {
    ...emptyModeler(),
    nodes: [n('u', 'unloader_1', null, srcLimit, MOSS), n('a', 'furnance_1', R_POWDER, null), n('b', 'furnance_1', R_CARBON, bLimit)],
    edges: [e('e1', 'u', 'a', MOSS), e('e2', 'a', 'b', POWDER)],
  });
}

/** Mô phỏng 1 giờ: số mẻ mỗi phút của lò A, lò B và lượng Carbon Đặc vào kho mỗi phút. */
function simulate(rate: number) {
  const { s, a, b } = mapChain(rate);
  const sim = createSimulation(s.bp, ds);
  sim.run(3600);
  return {
    a: sim.machine(a)!.stats.cycles / 60,
    b: sim.machine(b)!.stats.cycles / 60,
    stored: (sim.totals.depotIn.get(CARBON) ?? 0) / 60,
  };
}

describe('ba bộ tính ra cùng lưu lượng', () => {
  it('nguồn đủ (30/phút): mọi máy 100 %, 30 Carbon Đặc mỗi phút', () => {
    const { s, a, b } = mapChain(30);
    const r = solve(s.bp, ds);
    expect(r.converged).toBe(true);
    expect(r.machines.get(a)!.utilization).toBeCloseTo(1, 6);
    expect(r.machines.get(b)!.utilization).toBeCloseTo(1, 6);
    expect(r.balance.get(CARBON)!.produced).toBeCloseTo(30, 6);

    const m = modelerChain(null, 1);
    expect(m.converged).toBe(true);
    expect(m.nodes.get('a')!.actual).toBeCloseTo(1, 6);
    expect(m.nodes.get('b')!.actual).toBeCloseTo(1, 6);
    expect(m.raw.get(MOSS)).toBeCloseTo(30, 6);
    expect(m.edges.get('e2')).toBeCloseTo(r.balance.get(POWDER)!.produced, 6);

    const sim = simulate(30);
    for (const v of [sim.a, sim.b, sim.stored]) {
      expect(v).toBeGreaterThan(30 * 0.97);
      expect(v).toBeLessThanOrEqual(30 + 1e-9);
    }
  });

  it('nguồn thiếu (15/phút): mọi máy 50 %, 15 mỗi phút', () => {
    const { s, a, b } = mapChain(15);
    const r = solve(s.bp, ds);
    expect(r.converged).toBe(true);
    expect(r.machines.get(a)!.utilization).toBeCloseTo(0.5, 6);
    expect(r.machines.get(b)!.utilization).toBeCloseTo(0.5, 6);
    expect(r.balance.get(CARBON)!.produced).toBeCloseTo(15, 6);

    const m = modelerChain(0.5, 1); // nửa tuyến = 15/phút
    expect(m.nodes.get('a')!.actual).toBeCloseTo(0.5, 6);
    expect(m.nodes.get('b')!.actual).toBeCloseTo(0.5, 6);
    expect(m.edges.get('e2')).toBeCloseTo(15, 6);

    const sim = simulate(15);
    for (const v of [sim.a, sim.b, sim.stored]) {
      expect(v).toBeGreaterThan(15 * 0.97);
      expect(v).toBeLessThanOrEqual(15 + 0.05);
    }
  });

  it('nguồn dư (60/phút) vào một lò: băng chỉ chở 30 ⇒ vẫn 30 mỗi phút', () => {
    const { s, a } = mapChain(60);
    const r = solve(s.bp, ds);
    expect(r.machines.get(a)!.utilization).toBeCloseTo(1, 6);
    expect(r.balance.get(CARBON)!.produced).toBeCloseTo(30, 6);

    const m = modelerChain(2, 1);
    expect(m.nodes.get('a')!.actual).toBeCloseTo(1, 6);
    expect(m.edges.get('e2')).toBeCloseTo(30, 6);

    const sim = simulate(60);
    expect(sim.stored).toBeGreaterThan(30 * 0.97);
    expect(sim.stored).toBeLessThanOrEqual(30 + 1e-9);
  });
});

describe('báo "chưa ổn định"', () => {
  it('Modeler: vòng hàng quay lại chính nó (bột ⇄ khí Xiranite, hệ số 1) ⇒ converged = false thay vì im lặng hiện số vô lý', () => {
    const consumer = [...ds.recipes.values()].find((x) => !x.id.startsWith('liquid_transmuter') && x.ingredients.length === 1 && x.ingredients[0]!.itemId === 'item_xiranite_powder')!;
    const n = (id: string, recipeId: string, limit: number | null): MNode => ({ id, machineId: ds.recipes.get(recipeId)!.machineId, recipeId, x: 0, y: 0, limit });
    const e = (id: string, from: string, to: string, item: string): MEdge => ({ id, from: { node: from, item }, to: { node: to, item } });
    const r = computeModeler(ds, {
      ...emptyModeler(),
      nodes: [n('s', consumer.id, 1), n('b', 'liquid_transmuter_2_solid_xiranite_powder_1', null), n('a', 'liquid_transmuter_2_gas_gas_xiranite_1', null)],
      edges: [e('e1', 'b', 's', 'item_xiranite_powder'), e('e2', 'b', 'a', 'item_xiranite_powder'), e('e3', 'a', 'b', 'item_gas_xiranite')],
    });
    expect(r.converged).toBe(false);
  });

  it('Map: dây chuyền thường đứng yên trong vài vòng; kết quả có `residual` nhỏ', () => {
    const { s } = mapChain(30);
    const r = solve(s.bp, ds);
    expect(r.converged).toBe(true);
    expect(r.residual).toBeLessThan(1e-6);
    expect(r.iterations).toBeLessThan(300);
  });
});

describe('lý do nghẽn có cấu trúc (không đoán bằng câu chữ)', () => {
  it('lò B thiếu đầu vào ⇒ bottleneckKind "short"; kho đầu ra bị gỡ ⇒ "output"', () => {
    const { s, b } = mapChain(15);
    const short = solve(s.bp, ds).machines.get(b)!;
    expect(short.bottleneckKind).toBe('short');
    expect(short.limitedBy).toBe('input');
    const jam = mapChain(30);
    removeBeltGroup(jam.s.bp, jam.out);
    const blocked = solve(jam.s.bp, ds).machines.get(jam.b)!;
    expect(blocked.limitedBy).toBe('output');
    expect(blocked.bottleneckKind).toBe('output');
  });
});
