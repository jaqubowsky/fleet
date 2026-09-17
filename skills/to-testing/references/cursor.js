(() => {
  const draw = () => {
    if (document.getElementById('__agent_cursor')) return;

    const dot = document.createElement('div');
    dot.id = '__agent_cursor';
    dot.style.cssText = 'position:fixed;left:-50px;top:-50px;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid #ff2d55;background:rgba(255,45,85,.35);pointer-events:none;transition:transform .06s linear';
    document.documentElement.appendChild(dot);

    addEventListener('mousemove', e => {
      dot.style.left = e.clientX + 'px';
      dot.style.top = e.clientY + 'px';
    }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(1.9)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
  };

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', draw) : draw();
})();
