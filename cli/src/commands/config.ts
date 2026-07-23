import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { CliError, EXIT } from '../api/errors';
import { CONFIG_KEYS, configPath, saveConfig, type ConfigKey } from '../config';
import { resolveProject } from '../resolve';
import type { CliDeps } from '../context';

function storageKey(key: string): (typeof CONFIG_KEYS)[ConfigKey] {
  if (!(key in CONFIG_KEYS)) {
    throw new CliError(
      `Unknown config key "${key}"; valid keys: ${Object.keys(CONFIG_KEYS).join(', ')}`,
      EXIT.usage
    );
  }
  return CONFIG_KEYS[key as ConfigKey];
}

export function registerConfig(program: Command, deps: CliDeps): void {
  const config = new Command('config').description('Manage CLI configuration');

  config.addCommand(
    leaf('get')
      .description('Show one config value, or the whole config')
      .argument('[key]', `one of: ${Object.keys(CONFIG_KEYS).join(', ')}`)
      .action(
        withCtx(deps, async (ctx, _opts, key) => {
          if (key == null) {
            ctx.out.data(ctx.config, () => {
              for (const [display, storage] of Object.entries(CONFIG_KEYS)) {
                const value = ctx.config[storage];
                if (value != null) {
                  ctx.out.line(`${display} = ${value}`);
                }
              }
            });
            return;
          }
          const value = ctx.config[storageKey(key)];
          ctx.out.data(value ?? null, () => {
            if (value != null) {
              ctx.out.line(value);
            }
          });
        })
      )
  );

  config.addCommand(
    leaf('set')
      .description('Set a config value (default-project accepts an id or name)')
      .argument('<key>', `one of: ${Object.keys(CONFIG_KEYS).join(', ')}`)
      .argument('<value>', 'value to store')
      .action(
        withCtx(deps, async (ctx, _opts, key, value) => {
          const storage = storageKey(key);
          const stored =
            storage === 'default_project' ? (await resolveProject(ctx, value)).id : value;
          await saveConfig(ctx.configDir, { ...ctx.config, [storage]: stored });
          ctx.out.data({ [key]: stored }, () => ctx.out.line(`${key} = ${stored}`));
        })
      )
  );

  config.addCommand(
    leaf('unset')
      .description('Remove a config value')
      .argument('<key>', `one of: ${Object.keys(CONFIG_KEYS).join(', ')}`)
      .action(
        withCtx(deps, async (ctx, _opts, key) => {
          const storage = storageKey(key);
          const next = { ...ctx.config };
          delete next[storage];
          await saveConfig(ctx.configDir, next);
          ctx.out.data({ [key]: null }, () => ctx.out.line(`Unset ${key}`));
        })
      )
  );

  config.addCommand(
    leaf('path')
      .description('Print the config file path')
      .action(
        withCtx(deps, async (ctx) => {
          const path = configPath(ctx.configDir);
          ctx.out.data({ path }, () => ctx.out.line(path));
        })
      )
  );

  program.addCommand(config);
}
