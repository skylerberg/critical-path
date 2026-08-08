import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { appUpdate } from './lib/appUpdate';
import { motion } from './lib/motion.svelte';
import { themeColor } from './lib/theme-color';

appUpdate.init();
motion.init();
themeColor.init();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
