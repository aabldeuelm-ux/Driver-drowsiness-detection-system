import type {ClosureEventType} from './eventStore';

export const EYE_CLOSURE_POPUP_MESSAGE = 'Prolonged eye closure detected.';
export const YAWN_POPUP_MESSAGE = 'Possible yawn detected.';
export const POPUP_VISIBLE_MS = 9000;

export interface AlertPopup {
  id: string;
  type: ClosureEventType;
  message: string;
  timestamp: string;
  /** Duration already observed when the alert fired, in milliseconds. */
  durationMs: number;
}

export function popupMessageFor(type: ClosureEventType): string {
  return type === 'possible-yawn' ? YAWN_POPUP_MESSAGE : EYE_CLOSURE_POPUP_MESSAGE;
}

export function formatPopupDuration(durationMs: number): string {
  const seconds = Math.max(0, durationMs) / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
}

export function addAlertPopup(
  popups: readonly AlertPopup[],
  popup: AlertPopup,
  limit = 4,
): AlertPopup[] {
  return [...popups.filter((item) => item.id !== popup.id), popup].slice(-limit);
}

export function dismissAlertPopup(
  popups: readonly AlertPopup[],
  id: string,
): AlertPopup[] {
  return popups.filter((popup) => popup.id !== id);
}
