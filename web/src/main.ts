import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { appUpdate } from './lib/appUpdate';
import { motion } from './lib/motion.svelte';
import { themeColor } from './lib/theme-color';
import { viewport } from './lib/viewport.svelte';

appUpdate.init();
motion.init();
themeColor.init();
viewport.init();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
