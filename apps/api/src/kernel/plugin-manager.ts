import * as fs from 'fs';
import * as path from 'path';

export interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  type: string;
  description: string;
  instance: any;
  filePath: string;
  loadedAt: Date;
}

export class PluginKernel {
  private plugins = new Map<string, LoadedPlugin>();
  private pluginsDir: string;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir || path.resolve(__dirname, '../../../../plugins');
    this.init();
  }

  public init() {
    console.log(`[PluginKernel] Scanning plugins directory: ${this.pluginsDir}`);
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }

    this.loadAllPlugins();
    this.watchForChanges();
  }

  public loadAllPlugins() {
    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        this.loadPlugin(entry.name);
      }
    }
  }

  public loadPlugin(pluginFolder: string) {
    const indexPath = path.join(this.pluginsDir, pluginFolder, 'index.js');
    if (!fs.existsSync(indexPath)) return;

    try {
      // Clear require cache for hot-reload
      const resolved = require.resolve(indexPath);
      delete require.cache[resolved];

      const pluginModule = require(indexPath);
      const loaded: LoadedPlugin = {
        id: pluginModule.id || pluginFolder,
        name: pluginModule.name || pluginFolder,
        version: pluginModule.version || '1.0.0',
        type: pluginModule.type || 'CUSTOM',
        description: pluginModule.description || '',
        instance: pluginModule,
        filePath: indexPath,
        loadedAt: new Date(),
      };

      this.plugins.set(loaded.id, loaded);
      console.log(`[PluginKernel] Successfully loaded plugin: ${loaded.name} (v${loaded.version}) [${loaded.type}]`);
    } catch (err) {
      console.error(`[PluginKernel] Failed to load plugin from ${indexPath}:`, err);
    }
  }

  private watchForChanges() {
    try {
      fs.watch(this.pluginsDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const parts = filename.split(path.sep);
        const folder = parts[0];
        if (folder && folder !== '.') {
          console.log(`[PluginKernel] File change detected: ${filename} (${eventType}). Triggering Hot-Reload...`);
          this.loadPlugin(folder);
        }
      });
      console.log('[PluginKernel] Zero-downtime hot-reload file watcher active.');
    } catch (e) {
      console.warn('[PluginKernel] File watching fallback active.');
    }
  }

  public getPlugin(id: string) {
    return this.plugins.get(id);
  }

  public listPlugins() {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      type: p.type,
      description: p.description,
      loadedAt: p.loadedAt,
    }));
  }
}
