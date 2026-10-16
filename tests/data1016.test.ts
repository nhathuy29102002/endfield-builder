import { describe, expect, it } from 'vitest';
import { ds } from './helpers';

/** Dữ liệu cập nhật 2026-10-16 (`tools/merge-dataset.mjs`): công thức mới + nhãn LIMITED cho công thức sự kiện. */
describe('dữ liệu cập nhật 2026-10-16', () => {
  it('Sữa Đóng Chai: Máy Chiết Rót, lọ sắt + sữa', () => {
    const r = ds.recipes.get('filling_bottled_drink_2_1')!;
    expect(r.machineId).toBe('filling_powder_mc_1');
    expect(r.ingredients.map((s) => s.itemId).sort()).toEqual(['item_iron_bottle', 'item_ranch_milk_1']);
    expect(r.outcomes).toEqual([{ itemId: 'item_inn_drink_2', count: 1 }]);
    expect(ds.items.get('item_inn_drink_2')?.nameVi).toBe('Sữa Đóng Chai');
  });

  it('mọi công thức mới chạy trên máy có sẵn, mọi vật phẩm đều có trong bảng', () => {
    for (const id of ['seedcollector_plant_bean_1', 'grinder_Ingredient_flour_1', 'pool_Ingredient_oil_1', 'pool_ranch_fodder_2']) {
      const r = ds.recipes.get(id)!;
      expect(ds.machines.has(r.machineId), id).toBe(true);
      for (const s of [...r.ingredients, ...r.outcomes]) expect(ds.items.has(s.itemId), s.itemId).toBe(true);
    }
  });

  it('sản phẩm phụ không bị tính đôi (chỉ một lần trong outcomes sau khi gộp)', () => {
    for (const r of ds.recipes.values()) {
      const ids = r.outcomes.map((s) => s.itemId);
      expect(new Set(ids).size, r.id).toBe(ids.length);
    }
  });

  it('LIMITED = công thức dùng / làm ra vật phẩm sự kiện (item_activity_…); công thức thường không có nhãn', () => {
    const limited = [...ds.recipes.values()].filter((r) => r.limited);
    expect(limited.length).toBe(21);
    for (const r of limited) expect([...r.ingredients, ...r.outcomes].some((s) => s.itemId.startsWith('item_activity_')), r.id).toBe(true);
    expect(ds.recipes.get('filling_bottled_drink_2_1')!.limited).toBeFalsy();
    expect(ds.recipes.get('furnance_activity_xiranite_nugget_1')!.limited).toBe(true);
  });
});
