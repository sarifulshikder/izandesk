import * as fs from 'fs';
import * as path from 'path';
import chokidar = require('chokidar');
import { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import { PluginKernelEvent, PluginMetadata, PluginStatus, PluginType } from '@izandesk/shared-types';
import { LITE_MODE } from '../config/runtime';

export interface LoadedPlugin extends PluginMetadata {
  instance: any;
  loadedAtDate: Date;
}

export type PluginHookName = 'onLoad' | 'onReload' | 'onUnload' | 'onError';

export class PluginKernel extends EventEmitter {
  private plugins = new Map<string, LoadedPlugin>();
  private hooks = new Map<PluginHookName, Set<(payload: any) => void>>();
  private watcher?: FSWatcher;
  private pluginsDir: string;
  private ready = false;

  constructor(pluginsDir?: string) {
    super();
    // In source this resolves to <repo>/plugins; in a deployed image the built
    // files live in <app>/dist, so allow an explicit path (set in the images).
    this.pluginsDir = pluginsDir || process.env.PLUGINS_DIR || path.resolve(__dirname, '../../../../plugins');
    (['onLoad', 'onReload', 'onUnload', 'onError'] as PluginHookName[]).forEach((h) =>
      this.hooks.set(h, new Set())
    );
  }

  public async init(): Promise<void> {
    console.log(`[PluginKernel] Scanning plugins directory: ${this.pluginsDir}`);
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }
    await this.loadAllPlugins();
    // chokidar keeps an inotify watch (and periodic rescan) open for the whole
    // process lifetime. There is nothing to hot-reload in a shipped container.
    if (!LITE_MODE) this.watchForChanges();
    else console.log('[PluginKernel] Lite mode: hot-reload watcher disabled');
    this.ready = true;
  }

  public isReady() {
    return this.ready;
  }

  public onHook(hook: PluginHookName, handler: (payload: any) => void) {
    this.hooks.get(hook)?.add(handler);
    return () => this.hooks.get(hook)?.delete(handler);
  }

  private emitHook(hook: PluginHookName, payload: any) {
    for (const fn of this.hooks.get(hook) || []) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[PluginKernel] Hook ${hook} handler error`, e);
      }
    }
  }

  private emitKernelEvent(event: PluginKernelEvent) {
    this.emit('kernel:event', event);
  }

  public async loadAllPlugins(): Promise<void> {
    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await this.loadPlugin(entry.name, 'loaded');
      }
    }
  }

  public async loadPlugin(pluginFolder: string, reason: 'loaded' | 'reloaded' = 'loaded'): Promise<void> {
    if (!pluginFolder || pluginFolder.startsWith('.')) return;
    const indexPath = path.join(this.pluginsDir, pluginFolder, 'index.js');
    if (!fs.existsSync(indexPath)) {
      // if folder removed or invalid, remove tracked plugin by folder match
      this.removePluginsByFolder(pluginFolder);
      return;
    }

    try {
      const resolved = require.resolve(indexPath);
      delete require.cache[resolved];

      const pluginModule = require(indexPath);
      const id = String(pluginModule.id || pluginFolder);
      const previous = this.plugins.get(id);
      if (previous && previous.instance?.onUnload) {
        try { await previous.instance.onUnload(); } catch {}
      }

      const loadedAtDate = new Date();
      const loaded: LoadedPlugin = {
        id,
        name: String(pluginModule.name || pluginFolder),
        title: String(pluginModule.title || pluginModule.name || pluginFolder),
        version: String(pluginModule.version || '1.0.0'),
        type: (pluginModule.type || 'CUSTOM_HOOK') as PluginType,
        description: String(pluginModule.description || ''),
        author: pluginModule.author ? String(pluginModule.author) : undefined,
        instance: pluginModule,
        filePath: indexPath,
        isActive: pluginModule.isActive !== false,
        status: 'OK' as PluginStatus,
        lastReloadAt: loadedAtDate.toISOString(),
        loadedAtDate,
      };

      this.plugins.set(id, loaded);
      if (loaded.instance?.onLoad) {
        try { await loaded.instance.onLoad({ reason }); } catch {}
      }
      if (reason === 'reloaded' && loaded.instance?.onReload) {
        try { await loaded.instance.onReload({ previous }); } catch {}
      }

      const event: PluginKernelEvent = {
        type: reason,
        pluginId: id,
        timestamp: loaded.lastReloadAt,
        message: `${loaded.name} ${reason} successfully`,
        plugin: this.toMetadata(loaded),
      };
      this.emitKernelEvent(event);
      this.emitHook(reason === 'reloaded' ? 'onReload' : 'onLoad', { plugin: loaded, event });
      console.log(`[PluginKernel] ${reason === 'reloaded' ? 'Hot-reloaded' : 'Loaded'} plugin: ${loaded.name} (v${loaded.version}) [${loaded.type}]`);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`[PluginKernel] Failed to load plugin from ${indexPath}:`, err);
      const id = pluginFolder;
      const existing = this.plugins.get(id);
      if (existing) {
        existing.status = 'ERROR';
        existing.lastError = message;
        existing.lastReloadAt = new Date().toISOString();
      }
      const event: PluginKernelEvent = {
        type: 'error',
        pluginId: existing?.id || id,
        timestamp: new Date().toISOString(),
        message,
        plugin: existing ? this.toMetadata(existing) : undefined,
      };
      this.emitKernelEvent(event);
      this.emitHook('onError', { pluginFolder, error: err, event });
    }
  }

  private removePluginsByFolder(folder: string) {
    for (const [id, p] of this.plugins.entries()) {
      if (p.filePath.includes(path.sep + folder + path.sep)) {
        this.plugins.delete(id);
        const event: PluginKernelEvent = {
          type: 'removed',
          pluginId: id,
          timestamp: new Date().toISOString(),
          message: `${p.name} removed`,
        };
        this.emitKernelEvent(event);
        this.emitHook('onUnload', { plugin: p, event });
      }
    }
  }

  private watchForChanges() {
    this.watcher = chokidar.watch(this.pluginsDir, {
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });

    const handle = async (filePath: string, kind: string) => {
      const rel = path.relative(this.pluginsDir, filePath);
      const folder = rel.split(path.sep)[0];
      if (!folder || folder === '..') return;
      console.log(`[PluginKernel] ${kind} detected: ${rel}. Triggering hot-reload...`);
      const pluginDir = path.join(this.pluginsDir, folder);
      if (!fs.existsSync(pluginDir)) {
        this.removePluginsByFolder(folder);
        return;
      }
      const target = this.findByFolder(folder);
      if (target) target.status = 'RELOAD_PENDING';
      await this.loadPlugin(folder, this.findByFolder(folder) ? 'reloaded' : 'loaded');
    };

    this.watcher
      .on('add', (p) => handle(p, 'add'))
      .on('change', (p) => handle(p, 'change'))
      .on('unlink', (p) => handle(p, 'unlink'))
      .on('addDir', (p) => handle(p, 'addDir'))
      .on('unlinkDir', (p) => handle(p, 'unlinkDir'))
      .on('error', (err) => console.error('[PluginKernel] Watcher error', err));

    console.log('[PluginKernel] Zero-downtime hot-reload watcher active (chokidar).');
  }

  private findByFolder(folder: string): LoadedPlugin | undefined {
    for (const p of this.plugins.values()) {
      if (p.filePath.includes(path.sep + folder + path.sep)) return p;
    }
    return undefined;
  }

  public getPlugin(id: string) {
    return this.plugins.get(id);
  }

  public toMetadata(p: LoadedPlugin): PluginMetadata {
    return {
      id: p.id,
      name: p.name,
      title: p.title,
      version: p.version,
      type: p.type,
      isActive: p.isActive,
      lastReloadAt: p.lastReloadAt,
      status: p.status,
      author: p.author,
      description: p.description,
      filePath: p.filePath,
      lastError: p.lastError,
    };
  }

  public listPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map((p) => this.toMetadata(p));
  }

  public async reloadPlugin(id: string): Promise<PluginMetadata | null> {
    const plugin = this.plugins.get(id);
    if (!plugin) return null;
    const folder = path.basename(path.dirname(plugin.filePath));
    plugin.status = 'RELOAD_PENDING';
    await this.loadPlugin(folder, 'reloaded');
    return this.toMetadata(this.plugins.get(id)!);
  }

  public async reloadAll(): Promise<PluginMetadata[]> {
    const folders = fs.readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const folder of folders) {
      await this.loadPlugin(folder, 'reloaded');
    }
    return this.listPlugins();
  }

  public async shutdown(): Promise<void> {
    await this.watcher?.close();
  }
}
