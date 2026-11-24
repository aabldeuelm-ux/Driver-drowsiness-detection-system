import {describe, expect, it} from 'vitest';
import {
  addAlertPopup,
  dismissAlertPopup,
  EYE_CLOSURE_POPUP_MESSAGE,
  formatPopupDuration,
  POPUP_VISIBLE_MS,
  popupMessageFor,
  YAWN_POPUP_MESSAGE,
  type AlertPopup,
} from '../alertPopup';

function popup(id: string, type: AlertPopup['type']): AlertPopup {
  return {
    id,
    type,
    message: popupMessageFor(type),
    timestamp: '2026-01-01T00:00:00.000Z',
    durationMs: 900,
  };
}

describe('alert pop-ups', () => {
  it('uses exact, distinct messages for eye and yawn alerts', () => {
    expect(popupMessageFor('prolonged-eye-closure')).toBe(
      'Prolonged eye closure detected.',
    );
    expect(popupMessageFor('possible-yawn')).toBe('Possible yawn detected.');
    expect(EYE_CLOSURE_POPUP_MESSAGE).not.toBe(YAWN_POPUP_MESSAGE);
  });

  it('formats observed duration in readable seconds', () => {
    expect(formatPopupDuration(900)).toBe('0.9 s');
    expect(formatPopupDuration(12000)).toBe('12 s');
    expect(formatPopupDuration(-50)).toBe('0.0 s');
  });

  it('keeps an eye and a yawn pop-up visible together', () => {
    const eye = popup('popup-eye', 'prolonged-eye-closure');
    const yawn = popup('popup-yawn', 'possible-yawn');
    const stack = addAlertPopup(addAlertPopup([], eye), yawn);

    expect(stack.map((item) => item.id)).toEqual([eye.id, yawn.id]);
    expect(POPUP_VISIBLE_MS).toBeGreaterThan(0);

    const redelivered = addAlertPopup(stack, yawn);
    expect(redelivered).toHaveLength(2);
    expect(redelivered.at(-1)?.message).toBe(YAWN_POPUP_MESSAGE);
    expect(dismissAlertPopup(stack, eye.id).map((item) => item.id)).toEqual([yawn.id]);
  });
});
