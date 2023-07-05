import Debug from 'debug';
import { PageMetaDatum } from './types';
import fg from 'fast-glob';
import { FILE_EXTENSIONS, RESOLVED_MODULE_ID_VIRTUAL } from './constant';
import { ViteDevServer, ModuleNode } from 'vite';
import { slash } from '@dcloudio/uni-cli-shared/dist/vite/plugins/vitejs/utils';
export const debug = {
    hmr: Debug('vite-plugin-uni-pages-merge:hmr'),
    routeBlock: Debug('vite-plugin-uni-pages-merge:routeBlock'),
    options: Debug('vite-plugin-uni-pages-merge:options'),
    pages: Debug('vite-plugin-uni-pages-merge:pages'),
    subPages: Debug('vite-plugin-uni-pages-merge:subPages'),
    error: Debug('vite-plugin-uni-pages-merge:error'),
};

export function invalidatePagesModule(server: ViteDevServer) {
    const { moduleGraph } = server;
    const mods = moduleGraph.getModulesByFile(RESOLVED_MODULE_ID_VIRTUAL);
    if (mods) {
        const seen = new Set<ModuleNode>();
        mods.forEach(mod => {
            moduleGraph.invalidateModule(mod, seen);
        });
    }
}

export function extsToGlob(extensions: string[]) {
    return extensions.length > 1 ? `{${extensions.join(',')}}` : extensions[0] || '';
}
export function mergePageMetaDataArray(pageMetaData: PageMetaDatum[]) {
    const pageMetaDataGroup = groupPathBy(pageMetaData);
    const result: PageMetaDatum[] = [];
    for (const path in pageMetaDataGroup) {
        const _pageMetaData = pageMetaDataGroup[path];
        const options = _pageMetaData[0];
        for (const page of _pageMetaData) {
            options.style = Object.assign(options.style ?? {}, page.style ?? {});
            Object.assign(options, page);
        }
        result.push(options);
    }
    return result;
}

function groupPathBy(pageMetaData: PageMetaDatum[]) {
    const group: Record<string, PageMetaDatum[]> = {};
    for (let index = 0; index < pageMetaData.length; index++) {
        const element = pageMetaData[index];
        if (group[element.path]) {
            group[element.path].push(element);
        } else {
            group[element.path] = [];
            group[element.path].push(element);
        }
    }
    return group;
}

export async function getPagesConfigSourcePaths() {
    return await fg('pages.config.(ts|mts|cts|js|cjs|mjs|json)', {
        deep: 0,
        onlyFiles: true,
        absolute: true,
    });
}

export function isTargetFile(path: string) {
    const ext = path.split('.').pop();
    return FILE_EXTENSIONS.includes(ext!);
}

export function isMainJSON(path: string) {
    const maybe_main_json_base = slash(process.cwd() + '/pages.json');
    const maybe_main_json_cil = slash(process.cwd() + '/src/pages.json');
    const main_path = [maybe_main_json_cil, maybe_main_json_base];
    return main_path.includes(path);
}

export function isConfigFile(path: string) {
    return path.includes('pages.config');
}
