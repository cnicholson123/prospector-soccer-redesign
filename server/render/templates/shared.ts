import { html, type Html } from '../html.js';
import { icon } from '../icons.js';
import { displayDomain } from '../links.js';
import type { DocumentView } from '../snapshot-view.js';

export function delay(index: number, step: number): Html { return index ? html` style="--d: ${index * step}ms"` : html``; }
export function eventCard(event: DocumentView): Html {
  const date = new Date(event.text('date') + 'T12:00:00Z');
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const weekday = date.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const [hour, minute] = event.text('time').split(':').map(Number);
  const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
  return html`<li class="ticket" data-date="${event.text('date')}"${event.text('time') ? html` data-time="${event.text('time')}"` : html``} data-title="${event.text('calendarTitle') || event.text('title')}" data-where="${event.text('location')}">
    <div class="ticket__stub"><span class="ticket__month">${month}</span><span class="ticket__day">${date.getUTCDate()}</span><span class="ticket__dow">${weekday}</span></div>
    <div class="ticket__body"><span class="ticket__type">${event.text('type')}</span><h3 class="ticket__title"${event.edit('title')}>${event.text('title')}</h3>
      <div class="ticket__meta">${event.text('time') ? html`<span>${icon('clock')}${time}</span>` : html``}<span>${icon('pin')}${event.text('locationDetail') || event.text('location')}</span></div>
      <button class="ticket__add" type="button">${icon('plus')}Add to calendar</button></div>
  </li>`;
}
export function calloutCard(callout: DocumentView, index: number): Html {
  const style = ['gold', 'soft-gold', 'green', 'dark'].includes(callout.text('pillStyle')) ? callout.text('pillStyle') : 'gold';
  return html`<a class="callout" href="${callout.url('href')}"${callout.external('')} data-reveal${delay(index, 80)}>
    <span class="callout__icon">${icon(callout.text('icon'))}</span>
    <span><span class="pill pill--${style}">${callout.text('pillText')}</span><h3${callout.edit('title')}>${callout.text('title')}</h3><p${callout.edit('text')}>${callout.text('text')}</p></span>
    <span class="callout__go">${icon(callout.boolean('external') ? 'arrow-up-right' : 'arrow-right')}</span>
  </a>`;
}
export function resultCard(result: DocumentView, index = 0, stagger = false): Html {
  const place = result.number('place');
  const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
  const medal = place === 1 ? '' : place === 2 ? ' medal--silver' : ' medal--bronze';
  const gender = result.text('gender');
  return html`<li class="result" data-reveal${stagger ? delay(index, 80) : html``}><span class="medal${medal}" aria-hidden="true">${place}<sup>${suffix}</sup></span><div><p class="result__team"${result.edit('teamName')}>${result.text('teamName')}</p><p class="result__meta">${result.text('ageGroup')} ${gender.charAt(0).toUpperCase() + gender.slice(1)} · ${place}${suffix} place</p></div></li>`;
}
export function sponsorCard(sponsor: DocumentView, spaced = false): Html {
  return html`<li><a class="sponsor-card" href="${sponsor.url('url')}" target="_blank" rel="noopener"><span class="pill pill--soft-gold">Gold sponsor</span><p class="sponsor-card__name"${sponsor.edit('name')}>${sponsor.text('name')}</p><span class="sponsor-card__foot">${displayDomain(sponsor.text('url'))}${spaced ? ' ' : ''}${icon('arrow-up-right', ' width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"')}</span></a></li>`;
}
export function documentCard(document: DocumentView): Html {
  const form = document.text('kind') === 'form';
  const file = document.view.doc('media', document.text('source.fileId.mediaId'));
  const url = document.text('source.mode') === 'upload' ? file.url('variants.original') : document.url('source.url');
  return html`<li><a class="doc" href="${url}"${document.external('')} data-doc><span class="doc__icon${form ? ' doc__icon--form' : ''}">${form ? 'FORM' : document.text('kind').toUpperCase()}</span><span class="doc__text"><strong${document.edit('title')}>${document.text('title')}</strong><small${document.edit('description')}>${document.text('description')}</small></span><span class="doc__go">${icon('arrow-right')}</span></a></li>`;
}
export function teamCard(team: DocumentView): Html {
  const coaches = team.list('coaches');
  const gender = team.text('gender');
  const level = team.text('level');
  return html`<li class="team" data-gender="${gender}" data-age="${team.text('ageGroup')}"><span class="team__age">${team.text('ageGroup')}</span><span class="team__gender">${gender.charAt(0).toUpperCase() + gender.slice(1)}</span><span class="level level--${level.toLowerCase()}">${level}</span><p class="team__coach"${team.edit('coaches')}><small>${coaches.length === 1 ? 'Coach' : 'Coaches'}</small>${coaches.map(coach => coach.text('name')).join(', ')}</p></li>`;
}
export function tierCard(tier: DocumentView): Html {
  return html`<article class="tier${tier.boolean('featured') ? ' tier--gold' : ''}" data-reveal>${tier.boolean('featured') ? html`<div class="rays" aria-hidden="true"></div>` : html``}<h3 class="tier__name"${tier.edit('name')}>${tier.text('name')}</h3><p class="tier__price"><sup>$</sup>${tier.amount('price')}</p><ul class="checklist">${tier.list('benefits').map(benefit => html`<li${benefit.edit('text')}>${benefit.text('text')}</li>`)}</ul></article>`;
}
function initials(member: DocumentView): string { return member.text('name').split(/\s+/).filter(Boolean).map(part => part[0]).join('') || '?'; }
export function boardCard(member: DocumentView): Html {
  const [local, domain] = member.text('email').split('@');
  return html`<li class="person${member.boolean('isPresident') ? ' person--lead' : ''}${member.text('name') ? '' : ' person--vacant'}"><span class="person__avatar" aria-hidden="true">${initials(member)}</span><div><p class="person__role"${member.edit('role')}>${member.text('role')}</p><p class="person__name"${member.edit('name')}>${member.text('name') || member.text('vacantLabel') || 'Open position'}</p><a class="person__mail" href="${member.email('email')}">${local}<wbr>@${domain}</a>${member.boolean('volunteerLink') ? html`<p class="small"><a class="link-arrow" href="${member.email('email')}">Volunteer for this role</a></p>` : html``}${member.text('note') ? html`<p class="small muted">${member.text('note')}</p>` : html``}</div></li>`;
}
export function refereeContact(member: DocumentView, page: DocumentView): Html {
  return html`<span class="person__avatar">${initials(member)}</span><div><p class="person__role">${member.text('role')}</p><p class="person__name">${member.text('name')}</p><a class="person__mail" href="${member.email('email')}">${member.text('email')}</a></div><a class="btn btn--primary" href="${member.email('email')}">${page.text('contact.buttonLabel')}${icon('arrow-right')}</a>`;
}
