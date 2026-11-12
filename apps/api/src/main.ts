import { PluginKernel } from './kernel/plugin-manager';

async function bootstrap() {
  console.log('====================================================');
  console.log('    IzanDesk ERP Core Service — Starting Up...      ');
  console.log('====================================================');

  const kernel = new PluginKernel();
  const loadedPlugins = kernel.listPlugins();

  console.log(`[Bootstrap] Loaded ${loadedPlugins.length} hot-reloadable plugins into kernel memory.`);
  loadedPlugins.forEach((p) => {
    console.log(` - [${p.type}] ${p.name} v${p.version}`);
  });
}

bootstrap();
