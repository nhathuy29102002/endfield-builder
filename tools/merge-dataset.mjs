#!/usr/bin/env node
/**
 * merge-dataset.mjs — **thêm** vật phẩm / công thức mới từ một lần trích dữ liệu mới vào `data/`, không động tới
 * những gì đã có (người dùng 2026-10-16: bản dữ liệu mới có thêm Sữa Đóng Chai, cây trồng…).
 *
 * Vì sao không trích lại toàn bộ: `data/` có ràng buộc chỗ đặt máy lấy từ bản dữ liệu cũ (`--overlay`), tên đã chỉnh
 * tay…; lần trích mới thiếu những thứ đó. Nên chỉ gộp phần **chưa có**:
 *  - vật phẩm mới (theo `id`);
 *  - công thức mới (theo `id`), chuẩn hoá về đúng định dạng của `data/`:
 *      · sản phẩm phụ chỉ nằm ở `altOutcomes` (lần trích mới chép nó vào cả `outcomes` ⇒ tính đôi);
 *      · `buffers` dựng lại từ nguyên liệu + sản phẩm (lần trích mới cắt sai mã có chữ hoa: `item_Ingredient_…`);
 *  - nhãn **`limited: true`** cho công thức dùng / làm ra vật phẩm sự kiện (`item_activity_…` — "activity" là sự kiện
 *    trong mã của game; **suy luận**, bảng dữ liệu không có trường nào ghi rõ). Công thức đã có trường `limited` (sửa tay)
 *    thì giữ nguyên.
 * Máy mới (ô đất trồng `soil_*`, `sp_hub_2`…) **không** gộp: không có cổng, không phải công trình của nhà máy.
 *
 * Dùng:
 *   node tools/extract-dataset.mjs <bundle.js> <thư-mục-tạm>
 *   node tools/apply-names.mjs <bundle.js> <bảng-VN.js> <bảng-EN.js> <thư-mục-tạm>
 *   node tools/merge-dataset.mjs <thư-mục-tạm> [data]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [newDir, dataDir = 'data'] = process.argv.slice(2);
if (!newDir) {
  console.error('Dùng: node tools/merge-dataset.mjs <thư-mục-trích-mới> [data]');
  process.exit(1);
}
const read = (dir, name) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8'));
const write = (name, v) => writeFileSync(resolve(dataDir, `${name}.json`), JSON.stringify(v, null, 2) + '\n');

const isEvent = (itemId) => itemId.startsWith('item_activity_');

// ---------------------------------------------------------------- vật phẩm
const items = read(dataDir, 'items');
const haveItems = new Set(items.items.map((i) => i.id));
const addedItems = read(newDir, 'items').items.filter((i) => !haveItems.has(i.id));
items.items.push(...addedItems);

// ---------------------------------------------------------------- công thức
const recipes = read(dataDir, 'recipes');
const haveRecipes = new Set(recipes.recipes.map((r) => r.id));
const normalize = (r) => {
  const alt = new Set((r.altOutcomes ?? []).flat().map((s) => s.itemId));
  const outcomes = r.outcomes.filter((s) => !alt.has(s.itemId));
  const buffers = {};
  for (const s of [...r.ingredients, ...outcomes, ...(r.altOutcomes ?? []).flat()]) buffers[s.itemId] = 0;
  return { ...r, outcomes, buffers };
};
const addedRecipes = read(newDir, 'recipes').recipes.filter((r) => !haveRecipes.has(r.id)).map(normalize);
recipes.recipes.push(...addedRecipes);

// nhãn limited (công thức mới lẫn cũ; giữ nguyên nếu đã có trường `limited`)
let tagged = 0;
for (const r of recipes.recipes) {
  if ('limited' in r) continue;
  const all = [...r.ingredients, ...r.outcomes, ...(r.altOutcomes ?? []).flat()];
  if (all.some((s) => isEvent(s.itemId))) {
    r.limited = true;
    tagged++;
  }
}

// mọi vật phẩm mà công thức nhắc tới phải có trong bảng vật phẩm
const known = new Set(items.items.map((i) => i.id));
const missing = new Set();
for (const r of addedRecipes) for (const s of [...r.ingredients, ...r.outcomes, ...(r.altOutcomes ?? []).flat()]) if (!known.has(s.itemId)) missing.add(s.itemId);
const machines = new Set(read(dataDir, 'machines').machines.map((m) => m.id));
const noMachine = addedRecipes.filter((r) => !machines.has(r.machineId)).map((r) => r.id);

const stamp = new Date().toISOString();
items.generatedAt = recipes.generatedAt = stamp;
write('items', items);
write('recipes', recipes);

console.log(`vật phẩm mới: ${addedItems.length}`);
for (const i of addedItems) console.log(`  + ${i.id}  ${i.nameVi ?? i.name} / ${i.nameEn ?? ''}`);
console.log(`công thức mới: ${addedRecipes.length}`);
for (const r of addedRecipes) console.log(`  + ${r.id}  (${r.machineId})`);
console.log(`gắn nhãn limited: ${tagged} công thức`);
if (missing.size) console.log(`⚠ vật phẩm chưa có trong bảng: ${[...missing].join(', ')}`);
if (noMachine.length) console.log(`⚠ công thức chạy trên máy chưa có: ${noMachine.join(', ')}`);
