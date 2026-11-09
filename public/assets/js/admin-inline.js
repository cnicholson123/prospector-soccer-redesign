/* Private edit-mode bridge. No credentials or draft writes live in this frame. */
(() => {
  'use strict';
  const origin = location.origin;
  let enabled = false, siteSettings = false, active = null, initial = '', address = null;
  const post = payload => { if (parent !== window) parent.postMessage(payload, origin); };
  const parse = node => { try { return JSON.parse(node.dataset.edit); } catch { return null; } };
  function finish(cancel) {
    if (!active) return;
    const node = active, target = address;
    active = null; address = null;
    node.removeAttribute('contenteditable'); node.removeAttribute('role'); node.removeAttribute('aria-label');
    node.classList.remove('admin-inline-active');
    if (cancel) node.textContent = initial;
    post({ type: cancel ? 'cancel' : 'commit', ...target, value: node.textContent });
  }
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest('[data-edit]');
    if (!enabled || !node || parse(node)?.collection === 'site' && !siteSettings) {
      if (target?.closest('a') && parent !== window) event.preventDefault();
      return;
    }
    if (active === node) return;
    event.preventDefault(); event.stopPropagation();
    finish(false);
    const targetAddress = parse(node);
    if (targetAddress) post({ type: 'edit', ...targetAddress });
  }, true);
  document.addEventListener('keydown', event => {
    if (active) {
      if (event.key === 'Escape') { event.preventDefault(); finish(true); }
      else if (event.key === 'Enter') { event.preventDefault(); finish(false); }
    } else if (enabled && event.target instanceof Element && event.target.matches('[data-edit]') && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.target.click();
    }
  }, true);
  document.addEventListener('input', event => {
    if (event.target === active) post({ type: 'change', ...address, value: active.textContent });
  });
  document.addEventListener('focusout', event => { if (event.target === active) finish(false); });
  document.addEventListener('paste', event => {
    if (!active || event.target !== active) return;
    event.preventDefault();
    // Keep pasted content plain even in browsers without plaintext-only support.
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); range.deleteContents();
    const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    post({ type: 'change', ...address, value: active.textContent });
  });
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== parent || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'initialize') {
      enabled = data.editable === true;
      siteSettings = data.siteSettings === true;
      document.documentElement.classList.toggle('admin-inline-enabled', enabled);
      document.querySelectorAll('[data-edit]').forEach(node => {
        const editable = enabled && (parse(node)?.collection !== 'site' || siteSettings);
        node.classList.toggle('admin-inline-field', editable);
        if (editable) node.setAttribute('tabindex', '0'); else node.removeAttribute('tabindex');
      });
    }
    if (data.type === 'begin' && enabled && data.fieldType === 'text') {
      const node = [...document.querySelectorAll('[data-edit]')].find(node => {
        const target = parse(node); return target?.collection === data.collection && target?.id === data.id && target?.path === data.path;
      });
      if (!node) return;
      active = node; address = { collection: data.collection, id: data.id, path: data.path }; initial = String(data.value ?? '');
      node.textContent = initial; node.contentEditable = 'plaintext-only'; node.setAttribute('role', 'textbox');
      node.setAttribute('aria-label', data.label); node.classList.add('admin-inline-active'); node.focus();
    }
  });
  if (parent === window) {
    const banner = document.createElement('aside'); banner.className = 'admin-inline-standalone';
    const link = document.createElement('a'); link.href = '/admin/pages/' + (location.pathname === '/' ? 'home' : location.pathname.slice(1));
    link.textContent = 'Open the admin editor to edit this private preview'; banner.append(link); document.body.prepend(banner);
  }
  post({ type: 'ready' });
})();
