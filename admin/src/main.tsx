import { render } from 'preact';
import { collections } from '../../shared/schema';
import './styles/tokens.css';
import './styles/base.css';

render(<main class="welcome">
  <a class="brand" href="/"><img src="/assets/img/crest-sm.png" alt="" width="52" height="64" /><span>Prospector<small>Soccer Club · Admin</small></span></a>
  <section class="welcome-card" aria-labelledby="welcome-title">
    <span class="eyebrow">Club administration</span>
    <h1 id="welcome-title">A home for your club’s content.</h1>
    <p>The foundation is ready. Editing, sign-in and publishing will be added in the upcoming phases.</p>
    <div class="status"><span aria-hidden="true" class="status-dot" />{Object.keys(collections).length} content types defined</div>
    <a class="button" href="/">Back to the club <span aria-hidden="true">→</span></a>
  </section>
  <p class="welcome-note">Built for the people who make every season possible.</p>
</main>, document.getElementById('app')!);
