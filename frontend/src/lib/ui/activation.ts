export type Activation = () => void | Promise<void>;

function isDisabled(target: EventTarget | null): boolean {
  return target instanceof EventTarget && 'disabled' in target && target.disabled === true;
}

export function isPrimaryPointerActivation(event: Pick<PointerEvent, 'button' | 'isPrimary'>): boolean {
  return event.isPrimary && event.button === 0;
}

export function isKeyboardOrAssistiveClick(event: Pick<MouseEvent, 'detail'>): boolean {
  return event.detail === 0;
}

/** A drag always cancels activation. Fixed dialog controls can suppress compatibility mouse events to keep focus. */
export function activateFromPointer(
  event: PointerEvent,
  action: Activation,
  { preventPointerDownDefault = false }: { preventPointerDownDefault?: boolean } = {}
): void {
  if (!isPrimaryPointerActivation(event) || isDisabled(event.currentTarget)) return;
  if (preventPointerDownDefault) event.preventDefault();
  const target = event.currentTarget;
  if (!(target instanceof EventTarget)) {
    void action();
    return;
  }
  const pointerId = event.pointerId;
  let settled = false;
  const cleanup = () => {
    target.removeEventListener('pointerup', finish);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('lostpointercapture', cancel);
    target.removeEventListener('pointermove', move);
  };
  const cancel = (next: Event) => {
    if ('pointerId' in next && next.pointerId !== pointerId) return;
    settled = true;
    cleanup();
  };
  const finish = (next: Event) => {
    if (settled || !('pointerId' in next) || next.pointerId !== pointerId || ('isPrimary' in next && !next.isPrimary)) {
      return;
    }
    if (moved(next)) {
      cancel(next);
      return;
    }
    settled = true;
    cleanup();
    if (isDisabled(target)) return;
    void action();
  };
  const moved = (next: Event) =>
    'clientX' in next &&
    'clientY' in next &&
    Math.hypot(Number(next.clientX) - event.clientX, Number(next.clientY) - event.clientY) > 10;
  const move = (next: Event) => {
    if ('pointerId' in next && next.pointerId === pointerId && moved(next)) cancel(next);
  };
  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('lostpointercapture', cancel);
  target.addEventListener('pointermove', move);
  if ('setPointerCapture' in target && typeof target.setPointerCapture === 'function') {
    target.setPointerCapture(pointerId);
  }
}

export function activateFromKeyboardOrAssistiveClick(event: MouseEvent, action: Activation): void {
  if (!isKeyboardOrAssistiveClick(event) || isDisabled(event.currentTarget)) return;
  void action();
}
