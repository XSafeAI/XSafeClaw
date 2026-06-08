export const SESSION_LIST_ROW_ESTIMATE_PX = 92;
export const SESSION_LIST_MIN_VISIBLE = 1;

export function getSessionListVisibleCount(
  containerHeight: number,
  rowHeight = SESSION_LIST_ROW_ESTIMATE_PX,
): number {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return SESSION_LIST_MIN_VISIBLE;
  }
  const safeRowHeight = Number.isFinite(rowHeight) && rowHeight > 0
    ? rowHeight
    : SESSION_LIST_ROW_ESTIMATE_PX;
  return Math.max(SESSION_LIST_MIN_VISIBLE, Math.floor(containerHeight / safeRowHeight));
}
