import { describe, expect, it } from 'vitest';
import { planBelt } from '../src/editor/belts';
import { setRecipe } from '../src/editor/ops';
import { edgeVelocity, freeRect, EDGE_PX, EDGE_PX_TOUCH } from '../src/editor/edgePan';
import { footprintCells, worldPorts } from '../src/model/geometry';
import { ds, put, scene } from './helpers';

/** Người dùng 2026-10-26: nối ống thông minh vào cổng kích hoạt, cổng ra thật thay cho cổng ảo, tự cuộn sát mép. */
const bodyCell = (s: ReturnType<typeof scene>, uid: number, avoid: string[] = []) => {
  const m = s.bp.machines.find((v) => v.uid === uid)!;
  const def = ds.machines.get(m.machineId)!;
  const ports = new Set(worldPorts(m, def).map((p) => `${p.cell.x},${p.cell.z}`));
  return footprintCells(m, def).find((c) => !ports.has(`${c.x},${c.z}`) && !avoid.includes(`${c.x},${c.z}`)) ?? footprintCells(m, def)[0]!;
};

describe('cổng ra thật thay cho cổng ảo (Cửa Xả Ống Dẫn, Máy Bơm…)', () => {
  it('kéo ống từ thân Cửa Xả Ống Dẫn: ống ra từ đúng cổng out0, đúng hướng — kể cả khi con trỏ ở phía bên kia', () => {
    for (const target of [{ x: 2, z: 11 }, { x: 30, z: 11 }, { x: 11, z: 2 }]) {
      const s = scene();
      const u = put(s, 'udpipe_unloader_1', 10, 10);
      const plan = planBelt(s.bp, ds, { type: 'machine', uid: u }, target, 'pipe');
      expect(plan.from?.portKey, JSON.stringify(target)).toBe('out0');
      const out0 = worldPorts(s.bp.machines[0]!, ds.machines.get('udpipe_unloader_1')!).find((p) => p.key === 'out0')!;
      expect(plan.cells[0]).toEqual(out0.attach);
    }
  });
});

describe('nối thông minh vào cổng kích hoạt', () => {
  it('ống chở Khí Xiranite rê vào thân Máy Chuyển Hoá Khí Rắn (chưa công thức) ⇒ tự vào cổng kích hoạt', () => {
    const s = scene(60, 40);
    const a = put(s, 'transmuter_2', 6, 10);
    setRecipe(s.bp, ds, a, 'liquid_transmuter_2_gas_gas_xiranite_1'); // làm ra Khí Xiranite
    const b = put(s, 'transmuter_2', 30, 10);
    const act = ds.machines.get('transmuter_2')!.activatorPort;
    const plan = planBelt(s.bp, ds, { type: 'machine', uid: a }, bodyCell(s, b), 'pipe');
    expect(plan.ok).toBe(true);
    expect(plan.to).toEqual({ uid: b, portKey: act });
  });
  it('chưa biết chất đang chở ⇒ vẫn tránh cổng kích hoạt; máy chỉ có cổng kích hoạt (Máy Khuếch Tán) ⇒ vào đó', () => {
    const s = scene(60, 40);
    // Máy Chuyển Hoá Khí Lỏng: có cổng ống vào thường lẫn cổng kích hoạt
    const b = put(s, 'transmuter_1', 30, 10);
    const act = ds.machines.get('transmuter_1')!.activatorPort;
    const plan = planBelt(s.bp, ds, { type: 'cell', x: 10, z: 12 }, bodyCell(s, b), 'pipe');
    expect(plan.to?.uid).toBe(b);
    expect(plan.to?.portKey).not.toBe(act);
    const v = put(s, 'vaporizer_1', 30, 28);
    const p2 = planBelt(s.bp, ds, { type: 'cell', x: 10, z: 30 }, bodyCell(s, v), 'pipe');
    expect(p2.to).toEqual({ uid: v, portKey: ds.machines.get('vaporizer_1')!.activatorPort });
  });
});

describe('tự cuộn sát mép', () => {
  const R = { left: 100, top: 50, right: 1100, bottom: 750 };
  it('giữa khung ⇒ không; sát phải ⇒ nội dung trôi sang trái, sâu hơn ⇒ nhanh hơn; ra ngoài khung (máy tính) ⇒ không', () => {
    expect(edgeVelocity({ x: 600, y: 400 }, R, false)).toBeNull();
    const a = edgeVelocity({ x: 1100 - EDGE_PX / 2, y: 400 }, R, false)!;
    const b = edgeVelocity({ x: 1099, y: 400 }, R, false)!;
    expect(a.x).toBeLessThan(0);
    expect(a.y).toBe(0);
    expect(b.x).toBeLessThan(a.x);
    expect(edgeVelocity({ x: 1130, y: 400 }, R, false)).toBeNull();
    // góc trên trái ⇒ trôi xuống + sang phải
    const c = edgeVelocity({ x: 101, y: 51 }, R, false)!;
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeGreaterThan(0);
  });
  it('điện thoại: vùng mép rộng hơn; bảng che sát dưới thu khung lại, ngón tay đè lên bảng che ⇒ trôi tối đa', () => {
    expect(EDGE_PX_TOUCH).toBeGreaterThan(EDGE_PX);
    expect(edgeVelocity({ x: 600, y: 750 - EDGE_PX - 5 }, R, false)).toBeNull();
    expect(edgeVelocity({ x: 600, y: 750 - EDGE_PX - 5 }, R, true)).not.toBeNull();
    const sheet = { left: 100, top: 450, right: 1100, bottom: 750 }; // cửa sổ máy chiếm nửa dưới
    const free = freeRect(R, [sheet]);
    expect(free.bottom).toBe(450);
    const over = edgeVelocity({ x: 600, y: 600 }, free, true, R)!;
    const edge = edgeVelocity({ x: 600, y: 449 }, free, true, R)!;
    expect(over.y).toBeLessThan(0);
    expect(over.y).toBeLessThanOrEqual(edge.y);
    // bảng nhỏ giữa màn hình (không sát phía nào) không thu khung
    expect(freeRect(R, [{ left: 500, top: 300, right: 700, bottom: 500 }])).toEqual(R);
  });
});
