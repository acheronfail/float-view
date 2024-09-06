import './index.css';
import App from './lib/App.svelte';
import { mount } from 'svelte';

mount(App, { target: document.getElementById('app')! });
