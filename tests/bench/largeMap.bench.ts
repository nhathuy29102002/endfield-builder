import { bench, describe } from 'vitest';
import { setRecipe } from '../../src/editor/ops';
import { solve } from '../../src/sim/solver';
import { buildChain } from '../../src/model/recipeBook';
import { chainToModeler } from '../../src/modeler/fromChain';
import { computeModeler } from '../../src/modeler/calc';
import { buildChecklist } from '../../src/modeler/checklist';
import { ds, paint, put, scene, source, wire, type Scene } from '../helpers';

/**
 * **Benchmark map lớn** (2026-10-13): `npm run bench`. Không chạy trong `npm test` / CI. Map dựng bằng cách lặp lại một
 * chuỗi thật (mỏ → lò → lò → kho, nối băng) cạnh nhau — số máy và số ô băng tăng tuyến tính để thấy bộ giải có chậm
 * đi bất thường không (O(n²)…). Ghi kết quả lại trước / sau khi sửa bộ giải để so.
 */
const MOSS = 'item_plant_moss_enr_powder_1';
function bigMap(chains: number): Scene {
  const s = scene(chains * 8 + 20, 50);
  for (let k = 0; k < chains; k++) {
    const x = 10 + k * 8;
    paint(s.terrain, 'mine', x - 1, 39, 5, 5);
    const mine = put(s, 'miner_1', x, 40);
    const a = put(s, 'furnance_1', x, 34);
    const b = put(s, 'furnance_1', x, 28);
    const store = put(s, 'storager_1', x, 22);
    source(s, mine, MOSS, 30);
    setRecipe(s.bp, ds, a, 'furnance_carbon_enr_powder_1');
    setRecipe(s.bp, ds, b, 'furnance_carbon_enr_1');
    wire(s, mine, 0, a, 0);
    wire(s, a, 0, b, 0);
    wire(s, b, 0, store, 0);
  }
  return s;
}
const maps = new Map([10, 40, 100].map((n) => [n, bigMap(n)]));

describe('bộ giải thông lượng — map lớn', () => {
  for (const [n, s] of maps)
    bench(`${n} chuỗi (${s.bp.machines.length} máy, ${s.bp.belts.length} ô băng)`, () => {
      solve(s.bp, ds);
    });
});

describe('Modeler + Checklist — chuỗi dài', () => {
  const doc = chainToModeler(ds, buildChain(ds, 'item_equip_script_4_3'));
  const last = doc.nodes.find((n) => n.recipeId && ds.recipes.get(n.recipeId)?.outcomes.some((o) => o.itemId === 'item_equip_script_4_3'));
  if (last) last.limit = 4;
  bench(`computeModeler (${doc.nodes.length} nút)`, () => {
    computeModeler(ds, doc);
  });
  bench('buildChecklist', () => {
    buildChecklist(ds, doc);
  });
});
