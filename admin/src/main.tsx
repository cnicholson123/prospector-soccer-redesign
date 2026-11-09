import { render } from 'preact';
import { App } from './app.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/forms.css';
import './styles/responsive.css';
render(<App />, document.getElementById('app')!);
