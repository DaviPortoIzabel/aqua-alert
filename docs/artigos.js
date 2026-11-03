// Keep the GIF still until someone interacts; respect reduced motion.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
document.querySelectorAll('.hero-visual').forEach((visual) => {
  const image = visual.querySelector('[data-motion]');
  const still = image.getAttribute('src');
  const update = () => {
    const active = !reducedMotion.matches && (visual.matches(':hover') || visual.contains(document.activeElement));
    const source = active ? image.dataset.motion : still;
    if (image.getAttribute('src') !== source) image.setAttribute('src', source);
  };
  ['pointerenter', 'pointerleave', 'focusin', 'focusout'].forEach((event) => visual.addEventListener(event, update));
  reducedMotion.addEventListener('change', update);
});
