import './index.css';
import View from './components/View.svelte';
import Renderer from './components/Renderer.svelte';
import { mount } from 'svelte';

const target = document.getElementById('app')!;
const params = new URLSearchParams(window.location.search);
const app = params.get('app');

const canonical = document.createElement('link');
canonical.rel = 'canonical';
canonical.href =
  app === 'renderer' ? 'https://www.acheron.fail/float-view/?app=renderer' : 'https://www.acheron.fail/float-view/';
document.head.appendChild(canonical);

switch (app) {
  case 'renderer':
    mount(Renderer, { target });
    break;
  case 'view':
  default:
    mount(View, { target });
    break;
}
