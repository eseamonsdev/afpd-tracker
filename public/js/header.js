(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const toggle = header.querySelector('.nav-toggle');
  const nav = header.querySelector('.site-nav');
  const personnel = header.querySelector('.personnel-nav');
  const summary = personnel.querySelector('summary');
  const compact = window.matchMedia('(max-width: 64rem)');
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  let hoverOpened = false;

  const closePersonnel = () => {
    personnel.open = false;
    hoverOpened = false;
  };
  const syncLayout = () => {
    // Keep focus on a visible control when the layout changes.
    const focusInNav = nav.contains(document.activeElement);
    toggle.hidden = !compact.matches;
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', String(!compact.matches));
    closePersonnel();
    if (compact.matches && focusInNav) toggle.focus();
    else if (!compact.matches && document.activeElement === toggle) nav.querySelector('a').focus();
  };
  header.classList.add('nav-enhanced');
  syncLayout();
  compact.addEventListener('change', syncLayout);

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    if (!open) closePersonnel();
  });
  personnel.addEventListener('pointerenter', event => {
    if (!compact.matches && hover.matches && event.pointerType === 'mouse' && !personnel.open) {
      personnel.open = true;
      hoverOpened = true;
    }
  });
  personnel.addEventListener('pointerleave', () => {
    if (hoverOpened && !personnel.contains(document.activeElement)) closePersonnel();
  });
  // A first click on a hover-opened disclosure pins it open rather than closing it.
  summary.addEventListener('click', event => {
    if (hoverOpened) {
      event.preventDefault();
      hoverOpened = false;
    }
  });
  // Touch browsers can blur the disclosure before dispatching a link's click.
  // Only dismiss for keyboard focus departure after Tab has finished moving focus;
  // pointer users dismiss through the outside-click handler below.
  document.addEventListener('keyup', event => {
    if (event.key === 'Tab' && !personnel.contains(document.activeElement)) {
      closePersonnel();
    }
  });
  document.addEventListener('click', event => {
    if (!personnel.contains(event.target)) closePersonnel();
  });
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (personnel.open) {
      closePersonnel();
      summary.focus();
      event.preventDefault();
    } else if (compact.matches && nav.classList.contains('is-open')) {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
      event.preventDefault();
    }
  });
})();
