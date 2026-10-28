// DOM fixture for the shared template; the rendering tests check the real macro.
export function rowTemplate(Element) {
  return { content: { firstElementChild: { cloneNode() {
    const row = new Element('li'), button = new Element('button');
    const label = new Element('span'), time = new Element('time'), number = new Element('span');
    const duration = new Element('span'), ids = new Element('span');
    label.append(time, number); button.append(label, duration); row.append(button, ids);
    const slots = { '.radio-clip': button, '[data-radio-time]': time,
      '[data-radio-number]': number, '[data-radio-duration]': duration, '.radio-ids': ids };
    row.querySelector = selector => slots[selector];
    return row;
  } } } };
}
