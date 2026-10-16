import { describe, expect, it } from 'vitest';
import { LINK_FAMILY, familyIndex, linkFamily, nextInFamily } from '../src/editor/logistics';
import { holdRingRadius } from '../src/ui/holdRing';
import { ds } from './helpers';

/** Người dùng 2026-10-11: thanh bộ băng / ống (Tab đổi lần lượt) và vòng đếm giữ 0,75 s. */
describe('bộ băng / ống — Tab đổi lần lượt', () => {
  it('thứ tự: thường · tách · gộp · cảng kiểm soát · cầu, rồi quay lại thường', () => {
    for (const kind of ['belt', 'pipe'] as const) {
      let t = nextInFamily({ kind: 'link', linkKind: kind })!;
      const seen: string[] = [];
      for (let i = 0; i < 4; i++) {
        expect(t.kind).toBe('place');
        if (t.kind === 'place') seen.push(t.machineId);
        t = nextInFamily(t)!;
      }
      expect(seen).toEqual([...LINK_FAMILY[kind]]);
      expect(t).toEqual({ kind: 'link', linkKind: kind });
    }
    expect(LINK_FAMILY.belt.map((id) => ds.machines.get(id)?.name)).toEqual(['Van Tách', 'Van Gộp', 'Cảng Kiểm Soát Vật Phẩm', 'Mối Nối Băng Tải']);
  });

  it('giữ hướng xoay khi đổi giữa các van; ngoài bộ thì không đổi', () => {
    const t = nextInFamily({ kind: 'place', machineId: 'log_splitter', rot: 90, mode: 'new' });
    expect(t).toMatchObject({ kind: 'place', machineId: 'log_converger', rot: 90 });
    expect(familyIndex({ kind: 'place', machineId: 'log_pipe_connector', rot: 0, mode: 'new' })).toBe(4);
    expect(nextInFamily({ kind: 'select' })).toBeNull();
    expect(linkFamily({ kind: 'place', machineId: 'log_splitter', rot: 0, mode: 'move', sourceUid: 3 })).toBeNull();
    expect(linkFamily({ kind: 'place', machineId: 'furnance_1', rot: 0, mode: 'new' })).toBeNull();
  });
});

describe('vòng đếm giữ', () => {
  it('điện thoại: đường kính 2 cm (gấp đôi 1 cm cũ — 2026-10-12); máy tính nhỏ hơn', () => {
    expect(holdRingRadius(true) * 2).toBeCloseTo((2 * 96) / 2.54, 3);
    expect(holdRingRadius(false)).toBeLessThan(holdRingRadius(true));
  });
});
