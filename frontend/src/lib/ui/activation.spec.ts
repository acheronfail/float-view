import { describe, expect, it, vi } from 'vitest';
import {
  activateFromKeyboardOrAssistiveClick,
  activateFromPointer,
  isKeyboardOrAssistiveClick,
  isPrimaryPointerActivation,
} from './activation';

describe('cross-platform control activation', () => {
  it.each(['before press', 'before release'])('ignores a button disabled %s', (when) => {
    const action = vi.fn();
    const target = Object.assign(new EventTarget(), { disabled: when === 'before press' });
    const preventDefault = vi.fn();
    activateFromPointer(
      { button: 0, isPrimary: true, pointerId: 7, currentTarget: target, preventDefault } as unknown as PointerEvent,
      action
    );
    target.disabled = true;
    const release = Object.assign(new Event('pointerup'), { pointerId: 7, isPrimary: true });
    target.dispatchEvent(release);
    activateFromKeyboardOrAssistiveClick({ detail: 0, currentTarget: target } as unknown as MouseEvent, action);
    expect(action).not.toHaveBeenCalled();
    if (when === 'before press') expect(preventDefault).not.toHaveBeenCalled();
  });

  it('accepts only the primary pointer', () => {
    expect(isPrimaryPointerActivation({ button: 0, isPrimary: true })).toBe(true);
    expect(isPrimaryPointerActivation({ button: 1, isPrimary: true })).toBe(false);
    expect(isPrimaryPointerActivation({ button: 0, isPrimary: false })).toBe(false);
  });

  it('keeps synthesized keyboard and assistive clicks without repeating pointer clicks', () => {
    expect(isKeyboardOrAssistiveClick({ detail: 0 })).toBe(true);
    expect(isKeyboardOrAssistiveClick({ detail: 1 })).toBe(false);
  });

  it('dispatches each supported activation path once after pointer release', () => {
    const action = vi.fn();
    const preventDefault = vi.fn();
    const target = new EventTarget();
    const pointerup = new Event('pointerup');
    Object.defineProperties(pointerup, {
      pointerId: { value: 7 },
      isPrimary: { value: true },
    });

    activateFromPointer(
      {
        button: 0,
        isPrimary: true,
        pointerId: 7,
        currentTarget: target,
        preventDefault,
      } as unknown as PointerEvent,
      action
    );
    expect(action).not.toHaveBeenCalled();
    target.dispatchEvent(pointerup);
    activateFromKeyboardOrAssistiveClick({ detail: 1 } as MouseEvent, action);
    activateFromKeyboardOrAssistiveClick({ detail: 0 } as MouseEvent, action);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not activate after pointer cancellation', () => {
    const action = vi.fn();
    const target = new EventTarget();
    const event = (type: string) => {
      const next = new Event(type);
      Object.defineProperty(next, 'pointerId', { value: 9 });
      return next;
    };
    activateFromPointer(
      {
        button: 0,
        isPrimary: true,
        pointerId: 9,
        currentTarget: target,
        preventDefault() {},
      } as unknown as PointerEvent,
      action
    );
    target.dispatchEvent(event('pointercancel'));
    target.dispatchEvent(event('pointerup'));
    expect(action).not.toHaveBeenCalled();
  });

  it('can suppress native pointer focus while still rejecting a drag', () => {
    const action = vi.fn();
    const target = new EventTarget();
    const preventDefault = vi.fn();
    const point = { pointerId: 9, clientX: 20, clientY: 20, isPrimary: true };
    activateFromPointer(
      { ...point, button: 0, currentTarget: target, preventDefault } as unknown as PointerEvent,
      action,
      { preventPointerDownDefault: true }
    );

    target.dispatchEvent(Object.assign(new Event('pointermove'), { ...point, clientY: 60 }));
    target.dispatchEvent(Object.assign(new Event('pointerup'), point));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
  });

  it.each(['drag', 'release', 'cancel', 'tap'])('handles %s without suppressing scrolling by default', (gesture) => {
    const action = vi.fn();
    const preventDefault = vi.fn();
    const target = new EventTarget();
    const send = (type: string, y: number, pointerId = 9) => {
      const next = new Event(type);
      Object.assign(next, { pointerId, clientX: 20, clientY: y, isPrimary: true });
      target.dispatchEvent(next);
    };
    activateFromPointer(
      {
        button: 0,
        isPrimary: true,
        pointerId: 9,
        clientX: 20,
        clientY: 20,
        currentTarget: target,
        preventDefault,
      } as unknown as PointerEvent,
      action
    );
    // An unrelated finger cannot cancel the primary tap.
    send('pointermove', 100, 10);
    if (gesture === 'drag') {
      send('pointermove', 60);
      send('pointermove', 20);
    }
    if (gesture === 'cancel') send('pointercancel', 20);
    send('pointerup', gesture === 'release' ? 60 : 20);
    activateFromKeyboardOrAssistiveClick({ detail: 1 } as MouseEvent, action);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(gesture === 'tap' ? 1 : 0);
  });
});
