import { useEffect, useState } from 'preact/hooks';
import { api, message } from '../api.js';

/** Deployment state is never part of the editable content document. */
export function CheckoutStatus() {
  const [status, setStatus] = useState('Checking deployment checkout status…');
  useEffect(() => {
    let active = true;
    api<{ checkout: 'disabled' | 'enabled' }>('/shop/status').then(result => {
      if (active) setStatus(result.checkout === 'disabled'
        ? 'Checkout: disabled by deployment (proof of concept)'
        : 'Checkout: enabled for development only');
    }).catch(error => { if (active) setStatus('Checkout status unavailable: ' + message(error)); });
    return () => { active = false; };
  }, []);
  return <aside class="notice"><strong role="status">{status}</strong><p>This showcase accepts no orders. Deployment configuration controls checkout; publishing store settings cannot enable it.</p></aside>;
}
