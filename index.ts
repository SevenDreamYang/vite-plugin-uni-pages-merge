import { spawn } from 'child_process';
import path from 'path';
import type { PluginOption } from 'vite';
import { createLogger } from 'vite';
import { OUTPUT_NAME } from './constant';
import PageContext from './context';
import { checkPagesJsonFile } from './files';
import type { UserOptions } from './types';
import chokidar from 'chokidar';
export * from './config';
export * from './types';
export * from './constant';
export * from './context';
export * from './utils';
export * from './files';
export * from './options';
// export * from './customBlock';
async function restart() {
    return new Promise(resolve => {
        const build = spawn(process.argv.shift()!, process.argv, {
            cwd: process.cwd(),
            detached: true,
            env: process.env,
        });
        build.stdout?.pipe(process.stdout);
        build.stderr?.pipe(process.stderr);
        build.on('close', code => {
            resolve(process.exit(code!));
        });
    });
}

export default function vitePluginUniPagesMerge(userOptions: UserOptions = {}): PluginOption {
    const resolvedPagesJSONPath = path.join(process.cwd(), userOptions.outDir ?? 'src', OUTPUT_NAME);
    const isValidated = checkPagesJsonFile(resolvedPagesJSONPath);
    const ctx = new PageContext(userOptions, process.cwd());
    return {
        name: 'vite-plugin-uni-pages-merge',
        enforce: 'pre',
        async configResolved(config) {
            const logger = createLogger(undefined, {
                prefix: '[vite-plugin-uni-pages-merge]',
            });
            ctx.setLogger(logger);
            await ctx.updatePagesJSON();
            if (config.command === 'build') {
                if (!isValidated) {
                    ctx.logger?.warn(
                        'In build mode, if `pages.json` does not exist, the plugin cannot create the complete `pages.json` before the uni-app, so it restarts the build.',
                        {
                            timestamp: true,
                        },
                    );
                    await restart();
                }

                if (config.build.watch) ctx.setupWatcher(chokidar.watch(ctx.options.dirs));
            }
        },
        configureServer(server) {
            ctx.setupViteServer(server);
        },
    };
}
