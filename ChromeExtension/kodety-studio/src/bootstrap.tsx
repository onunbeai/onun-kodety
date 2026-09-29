import { renderStudioApp } from './main';
// Entrypoints own shell styles. The Web App imports this shared module too,
// and loads the shell in Tailwind's base layer so it cannot override Builder UI.
import './styles.css';

renderStudioApp();
