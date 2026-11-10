// What agent code is told about the functions in guest.ts. Each product says
// where they are (globals, or methods of a machine) and what it adds, and
// tells only of what its computers can do. multidesktop/m11 includes this
// file as text, so each part is a String.raw without backticks.

export const screenText = String.raw`Points are pixels of a full screenshot. A target is a point {x, y}, or a region {x, y, width, height} meaning its centre.
screenshot() attaches the screen to the result and returns its size; take one to see what an action did.
click(target, {button, count}), doubleClick(target), move(target), drag(from, to), scroll(target, {dy, dx}) in lines (positive is down and right), type(text), key(keys) such as key("enter") or key("cmd+shift+t"), wait(ms).`;

export const regionText = String.raw`screenshot(region) shows just that region at up to the display's own resolution, for reading small text, and returns the region it shows (cut to the screen) and its scale (image pixels per screen pixel).`;

export const appsText = String.raw`open(urlPathOrAppName) opens it. apps() lists the running applications with their windows.
ui({app, menus}) returns an application's accessibility tree (the frontmost by default; app by name or pid; menus: true adds its menu bar) as an outline, one element a line: id role "name" = value, then settable when setValue() works on it and actions: what else perform() can do. An element keeps its id while it lasts, across calls, in the eight applications looked at last. A call that acts ends with what changed in the outline you last saw: + new, ~ changed, the ids removed, and the focus.
find(query, {app, within}) returns the elements matching query, an object of role (button, textfield, checkbox, menuitem, link, text, …), name, value, or a function of the element; strings match case-insensitively as substrings, or pass a RegExp. element(query or id, {app, timeout}) waits for the first match (3 s by default).
An element has id, role, name, value, x, y, width and height, and it or its id is a target too. press(target), focus(target), setValue(target, text) and perform(target, action) work through accessibility without the mouse, even in windows behind others: prefer them to clicks where an app has elements.`;
