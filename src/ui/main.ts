import './styles.css';
import './beatline.css';
import { App } from './app';

const root = document.getElementById('app')!;
const app = new App(root);
// Handy for debugging from DevTools
(window as unknown as { beatline_app: App }).beatline_app = app;
