import { describe, expect, it } from 'vitest';
import { ACTIVATOR_GLOW, PIPE_IN_GLOW, PIPE_OUT_COLORS, portGlowColor } from '../src/render/portColors';
import { layoutIcons } from '../src/ui/simChart';
import { activePorts, type PortKey } from '../src/model/types';
import { ds } from './helpers';

describe('dải sáng ở ô kề cổng (người dùng 2026-10-05; luật đổi 2026-10-26)', () => {
  it('cổng ra ống của Lò Phản Ứng / Lò Mở Rộng / Quả Cầu Phản Ứng Khí / Máy Tinh Chế: đúng màu vàng / cam của cổng', () => {
    for (const id of ['mix_pool_1', 'mix_pool_2', 'gas_reactor_1', 'liquid_purifier_1', 'transmuter_1', 'transmuter_2']) {
      const def = ds.machines.get(id)!;
      const outs = def.ports.filter((p) => p.dir === 'out' && p.kind === 'pipe' && !p.virtual).sort((a, b) => a.index - b.index);
      expect(outs.length, id).toBe(2);
      expect(portGlowColor(def, `out${outs[0]!.index}`), id).toBe(PIPE_OUT_COLORS[0]);
      expect(portGlowColor(def, `out${outs[1]!.index}`), id).toBe(PIPE_OUT_COLORS[1]);
      // cổng băng: không có dải. Luật đổi 2026-10-26: cổng **ống vào** (trừ kích hoạt) của chế độ đang bật có dải trắng
      for (const p of activePorts(def)) {
        const key = `${p.dir}${p.index}` as PortKey;
        if (key === def.activatorPort) continue;
        if (p.kind === 'belt') expect(portGlowColor(def, key), `${id} ${key}`).toBeUndefined();
        else if (p.dir === 'in') expect(portGlowColor(def, key), `${id} ${key}`).toBe(PIPE_IN_GLOW);
      }
    }
  });
  it('cổng kích hoạt của máy cần chất kích hoạt: xanh lá', () => {
    for (const def of ds.machines.values())
      if (def.activatorPort) expect(portGlowColor(def, def.activatorPort), def.id).toBe(ACTIVATOR_GLOW);
    expect(portGlowColor(ds.machines.get('transmuter_1')!, 'in2')).toBe(ACTIVATOR_GLOW);
  });
  it('2026-10-26: mọi máy — ống vào trắng; một đầu ống ra ⇒ cam, hai đầu ⇒ vàng / cam; van / cầu và cổng băng thì không', () => {
    expect(portGlowColor(ds.machines.get('udpipe_unloader_2')!, 'out0')).toBe(PIPE_OUT_COLORS[0]);
    expect(portGlowColor(ds.machines.get('udpipe_unloader_2')!, 'out1')).toBe(PIPE_OUT_COLORS[1]);
    expect(portGlowColor(ds.machines.get('pump_1')!, 'out0')).toBe(PIPE_OUT_COLORS[1]);
    expect(portGlowColor(ds.machines.get('liquid_storager_1')!, 'in0')).toBe(PIPE_IN_GLOW);
    expect(portGlowColor(ds.machines.get('liquid_storager_1')!, 'out0')).toBe(PIPE_OUT_COLORS[1]);
    expect(portGlowColor(ds.machines.get('furnance_1')!, 'out0')).toBeUndefined(); // cổng băng
    expect(portGlowColor(ds.machines.get('log_pipe_splitter')!, 'out0')).toBeUndefined();
    expect(portGlowColor(ds.machines.get('log_pipe_connector')!, 'in0')).toBeUndefined();
    // cổng ảo (đẩy thẳng vào máy kề) không có dải
    expect(portGlowColor(ds.machines.get('pump_1')!, 'out1')).toBeUndefined();
  });
  it('máy đổi chế độ rắn ⇄ lỏng: dải theo bộ cổng của chế độ đang bật', () => {
    const def = [...ds.machines.values()].find((d) => d.modePorts && d.ports.some((p) => p.kind === 'pipe' && p.dir === 'in'))!;
    expect(def, 'có máy đổi bộ cổng theo chế độ').toBeTruthy();
    const pipeIn = def.ports.find((p) => p.kind === 'pipe' && p.dir === 'in')!;
    const key = `in${pipeIn.index}` as PortKey;
    const on = (['A', 'B'] as const).filter((m) => activePorts(def, m).includes(pipeIn));
    const off = (['A', 'B'] as const).filter((m) => !activePorts(def, m).includes(pipeIn));
    for (const m of on) expect(portGlowColor(def, key, m), `${def.id} ${m}`).toBe(PIPE_IN_GLOW);
    for (const m of off) expect(portGlowColor(def, key, m), `${def.id} ${m}`).toBeUndefined();
  });
});

describe('biểu đồ mô phỏng: ảnh món ở cột bên phải (người dùng 2026-10-05)', () => {
  it('ảnh xa nhau giữ đúng độ cao, cột đầu', () => {
    expect(layoutIcons([30, 90], 18, 0, 170)).toEqual([
      { col: 0, y: 30 },
      { col: 0, y: 90 },
    ]);
  });
  it('hai đường trùng nhau ⇒ ảnh thứ hai sang cột bên cạnh, cùng độ cao', () => {
    expect(layoutIcons([50, 50], 18, 0, 170)).toEqual([
      { col: 0, y: 50 },
      { col: 1, y: 50 },
    ]);
  });
  it('10 đường cùng một chỗ: không ảnh nào chồng lên nhau, không lọt khỏi vùng vẽ', () => {
    const out = layoutIcons(new Array(10).fill(160), 18, 0, 170);
    for (const c of [0, 1]) {
      const ys = out.filter((o) => o.col === c).map((o) => o.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(18 - 1e-9);
      for (const y of ys) {
        expect(y).toBeGreaterThanOrEqual(9);
        expect(y).toBeLessThanOrEqual(161);
      }
    }
  });
});

describe('icon chế độ máy lấy từ trang tham khảo (người dùng 2026-10-05, lần 2)', () => {
  it('mọi máy có hai chế độ đều có icon cho cả A và B, đúng như trang tham khảo', async () => {
    const { MACHINE_MODE_ICONS, MODE_ICON_PATHS } = await import('../src/ui/modeIcons');
    for (const def of ds.machines.values())
      if (def.modes?.length === 2) {
        const m = MACHINE_MODE_ICONS[def.id];
        expect(m, def.id).toBeDefined();
        expect(MODE_ICON_PATHS[m!.A], def.id).toBeTruthy();
        expect(MODE_ICON_PATHS[m!.B], def.id).toBeTruthy();
      }
    expect(MACHINE_MODE_ICONS.furnance_1).toEqual({ A: 'solid', B: 'liquid' });
    expect(MACHINE_MODE_ICONS.transmuter_2).toEqual({ A: 'gas', B: 'solid' });
  });
});
