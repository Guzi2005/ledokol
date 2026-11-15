export function helmIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "helm-icon");
  svg.innerHTML = '<circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="2"/><path d="M12 1.6v4.2M12 18.2v4.2M1.6 12h4.2M18.2 12h4.2M4.7 4.7l2.9 2.9M16.4 16.4l2.9 2.9M19.3 4.7l-2.9 2.9M7.6 16.4l-2.9 2.9"/>';
  return svg;
}