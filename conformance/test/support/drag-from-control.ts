import type { Locator } from 'playwright';

/** Move beyond tap tolerance and return before releasing the captured pointer. */
export async function dragFromControl(control: Locator) {
  await control.hover();
  const box = (await control.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const mouse = control.page().mouse;
  await mouse.down();
  await mouse.move(x, y - 40);
  await mouse.move(x, y);
  await mouse.up();
  return { x, y };
}
