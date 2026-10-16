import { el } from './dom';
import { tr } from '../i18n';

/**
 * Thẻ **LIMITED** (người dùng 2026-10-16): công thức sự kiện (`RecipeDef.limited`) và mục "Vật phẩm phức hợp giới hạn"
 * (vật phẩm `item_activity_…`). Màu xanh lá sáng — `.rc-limited` trong `style.css`.
 */
export const limitedBadge = (): HTMLElement =>
  el('span', { class: 'rc-limited', title: tr('Vật phẩm / công thức sự kiện — chỉ có trong thời gian giới hạn') }, 'LIMITED');
