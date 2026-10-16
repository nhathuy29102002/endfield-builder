import { describe, expect, it } from 'vitest';
import { exportLibrary, importFile, newId, type SavedBlueprint } from '../src/blueprint/library';
import { toJson } from '../src/blueprint/serialize';
import { scene, put } from './helpers';

/** Kiểm tra bản vẽ nhập từ ngoài (2026-10-13): bản hợp lệ nhập bình thường, bản hỏng bị chặn có lời giải thích. */
const s = scene(30, 30);
put(s, 'furnance_1', 5, 5);
const mapEntry = (bp: unknown): SavedBlueprint => ({ id: newId(), name: 'm', icon: null, kind: 'map', created: 1, preview: '', map: { blueprint: bp as never, terrain: {} } });

describe('nhập bản vẽ', () => {
  it('bản xuất của chính ứng dụng nhập lại được (thư viện + file .json cũ)', () => {
    const lib = exportLibrary([mapEntry(s.bp), { id: newId(), name: 'mod', icon: null, kind: 'module', created: 1, preview: '', module: { machines: [], tiles: [] } }]);
    expect(importFile(lib, 'a.efp.json').map((b) => b.kind)).toEqual(['map', 'module']);
    expect(importFile(toJson(s.bp, s.terrain), 'cu.json')[0]!.map!.blueprint.machines.length).toBe(1);
  });
  it('máy thiếu toạ độ / hướng sai ⇒ chặn, báo lỗi', () => {
    const broken = JSON.parse(toJson(s.bp, s.terrain));
    broken.blueprint.machines[0].x = 'abc';
    expect(() => importFile(JSON.stringify(broken), 'x.json')).toThrow(/hỏng/);
    broken.blueprint.machines[0].x = 5;
    broken.blueprint.machines[0].rot = 45;
    expect(() => importFile(JSON.stringify(broken), 'x.json')).toThrow(/hỏng/);
  });
  it('kích thước map vô lý ⇒ chặn', () => {
    const broken = JSON.parse(toJson(s.bp, s.terrain));
    broken.blueprint.area = { w: 1e7, d: 10 };
    expect(() => importFile(JSON.stringify(broken), 'x.json')).toThrow(/hỏng/);
  });
  it('file thư viện: bản hỏng bị bỏ qua, bản tốt vẫn nhập', () => {
    const good = mapEntry(s.bp);
    const badMod = { id: 'x', name: 'hỏng', icon: null, kind: 'module', created: 1, preview: '', module: { machines: [{ uid: 1 }], tiles: [] } };
    const got = importFile(JSON.stringify({ format: 'efp-library', version: 1, blueprints: [good, badMod] }), 'l.json');
    expect(got).toHaveLength(1);
    expect(got[0]!.kind).toBe('map');
    // hỏng hết ⇒ lỗi
    expect(() => importFile(JSON.stringify({ format: 'efp-library', version: 1, blueprints: [badMod] }), 'l.json')).toThrow(/hỏng/);
  });
});
