export interface OpenClawPluginApi {
  pluginConfig?: Record<string, unknown>;
  logger: {
    warn?: (msg: string) => void;
    info?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  on(event: string, handler: (...args: any[]) => any): void;
}
