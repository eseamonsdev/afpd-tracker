(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const toggle = header.querySelector('.nav-toggle');
  const nav = header.querySelector('.site-nav');
  const dropdowns = [...header.querySelectorAll('.personnel-nav')];
  const compact = window.matchMedia('(max-width: 64rem)');
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  const hoverOpened = new Set();
  const closeDropdown = dropdown => {
    dropdown.open = false;
    hoverOpened.delete(dropdown);
  };
  const closeAll = () => dropdowns.forEach(closeDropdown);
  const syncLayout = () => {
    // Keep focus on a visible control when the layout changes.
    const focusInNav = nav.contains(document.activeElement);
    toggle.hidden = !compact.matches;
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', String(!compact.matches));
    closeAll();
    if (compact.matches && focusInNav) toggle.focus();
    else if (!compact.matches && document.activeElement === toggle) nav.querySelector('a').focus();
  };
  header.classList.add('nav-enhanced');
  syncLayout();
  compact.addEventListener('change', syncLayout);

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (!open) closeAll();
  });
  dropdowns.forEach(dropdown => {
    const summary = dropdown.querySelector('summary');
    dropdown.addEventListener('pointerenter', event => {
      if (!compact.matches && hover.matches && event.pointerType === 'mouse' && !dropdown.open) {
        dropdowns.filter(other => other !== dropdown).forEach(closeDropdown);
        dropdown.open = true;
        hoverOpened.add(dropdown);
      }
    });
    dropdown.addEventListener('pointerleave', () => {
      if (hoverOpened.has(dropdown) && !dropdown.contains(document.activeElement)) closeDropdown(dropdown);
    });
    // Clicking a hover-opened disclosure pins it open.
    summary.addEventListener('click', event => {
      dropdowns.filter(other => other !== dropdown).forEach(closeDropdown);
      if (hoverOpened.has(dropdown)) {
        event.preventDefault();
        hoverOpened.delete(dropdown);
      }
    });
    // Wait for Tab to move focus; touch links must remain open through their click.
    document.addEventListener('keyup', event => {
      if (event.key === 'Tab' && !dropdown.contains(document.activeElement)) closeDropdown(dropdown);
    });
    document.addEventListener('click', event => {
      if (!dropdown.contains(event.target)) closeDropdown(dropdown);
    });
  });
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openDropdown = dropdowns.find(dropdown => dropdown.open);
    if (openDropdown) {
      closeAll();
      openDropdown.querySelector('summary').focus();
      event.preventDefault();
    } else if (compact.matches && nav.classList.contains('is-open')) {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
      event.preventDefault();
    }
  });
})();
