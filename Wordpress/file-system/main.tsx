import { createRoot } from 'react-dom/client';
import FileSystemApp from './FileSystemApp';
import './styles.css';

document.documentElement.classList.add('dark', 'kodety-file-system-document');
document.body.classList.add('kodety-file-system');

// Current standalone shells use the `-root` id. Keep the earlier `-app`
// mount as a migration fallback so an asset update never leaves a blank page.
let rootElement = document.getElementById('kodety-file-system-root')
  || document.getElementById('kodety-file-system-app');
if (!rootElement) {
  rootElement = document.createElement('div');
  rootElement.id = 'kodety-file-system-root';
  document.body.appendChild(rootElement);
}

createRoot(rootElement).render(<FileSystemApp />);
