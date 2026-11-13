import { PluginKernel } from './plugin-manager';

let kernel: PluginKernel | null = null;
export function setKernel(k: PluginKernel) { kernel = k; }
export function getKernel() { return kernel; }