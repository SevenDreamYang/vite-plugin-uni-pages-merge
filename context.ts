import path from 'path';
import { checkPagesJsonFile, getPageFiles, getRoute, writeFileSync } from './files';
import { OUTPUT_NAME } from './constant';
import type { PagesConfig } from './config';
import { FSWatcher, Logger, ViteDevServer } from 'vite';
import { debug, mergePageMetaDataArray, getPagesConfigSourcePaths, isTargetFile, isConfigFile, invalidatePagesModule, isMainJSON } from './utils';
import dbg from 'debug';
import { loadConfig } from 'unconfig';
import { slash } from '@dcloudio/uni-cli-shared/dist/vite/plugins/vitejs/utils';
import type { PagePath, PageMetaDatum, UserOptions, ResolvedOptions } from './types';
import { resolveOptions } from './options';

export default class PageContext {
    private root: string;
    private resolvedPagesJSONPath = '';
    options: ResolvedOptions;
    logger: Logger | undefined;
    pagesGlobConfig: PagesConfig | undefined;
    pageMetaData: any;
    rawOptions: UserOptions;
    pagesPath: PagePath[] = [];
    subPagesPath: Record<string, PagePath[]> = {};
    subPageMetaData: { root: string; pages: PageMetaDatum[] }[];
    _server: ViteDevServer | undefined;
    constructor(userOptions: UserOptions = {}, viteRoot = process.cwd()) {
        this.rawOptions = userOptions;
        this.root = slash(viteRoot);
        debug.options('root', this.root);
        this.options = resolveOptions(userOptions, this.root);
        // debug logic
        const debugOption = this.options.debug;
        if (debugOption) {
            const prefix = 'vite-plugin-uni-pages-merge:';
            const suffix = typeof debugOption === 'boolean' ? '*' : debugOption;
            dbg.enable(`${prefix}${suffix}`);
        }
        this.resolvedPagesJSONPath = path.join(this.root, this.options.outDir, OUTPUT_NAME);
        debug.options(this.options);
    }

    async loadUserPagesConfig() {
        const { config } = await loadConfig<PagesConfig>({ sources: [{ files: 'pages.config' }] });
        if (!config) {
            this.logger?.warn("Can't found pages.config, please create pages.config.(ts|mts|cts|js|cjs|mjs|json)");
            process.exit(-1);
        }
        this.pagesGlobConfig = config;
        debug.options(config);
    }

    async parsePages(pages: PagePath[], overrides?: PageMetaDatum[]) {
        const generatedPageMetaData = await Promise.all(pages.map(async page => await this.parsePage(page)));
        const _generatedPageMetaData = generatedPageMetaData.map(item => item.pages).flat();
        const customPagesMetahData = overrides || [];
        const result = customPagesMetahData.length ? mergePageMetaDataArray(_generatedPageMetaData.concat(customPagesMetahData)) : _generatedPageMetaData;
        this.setHomePage(result);
        result.sort(page => (page.type === 'home' ? -1 : 0));
        return result;
    }

    setupViteServer(server: ViteDevServer) {
        if (this._server === server) return;

        this._server = server;
        this.setupWatcher(server.watcher);
    }

    async setupWatcher(watcher: FSWatcher) {
        if (!(process.env.UNI_PLATFORM === 'h5')) {
            const configs = await getPagesConfigSourcePaths();
            watcher.add(configs);
        }
        watcher.on('add', async path => {
            path = slash(path);
            if (!isTargetFile(path)) return;
            debug.pages(`File added: ${path}`);
            this.updatePagesJSON();
            this.onUpdate();
        });

        watcher.on('change', async path => {
            path = slash(path);
            if (isMainJSON(path)) return;
            if (!isTargetFile(path) && !isConfigFile(path)) return;
            debug.pages(`File changed: ${path}`);
            this.updatePagesJSON();
            this.onUpdate();
        });

        watcher.on('unlink', async path => {
            path = slash(path);
            if (!isTargetFile(path)) return;
            debug.pages(`File removed: ${path}`);
            this.updatePagesJSON();
            this.onUpdate();
        });
    }

    onUpdate() {
        if (!this._server) return;

        invalidatePagesModule(this._server);
        debug.hmr('Reload generated pages.');
        this._server.ws.send({
            type: 'full-reload',
        });
    }

    async parsePage(page: PagePath): Promise<PageMetaDatum> {
        const { absolutePath } = page;
        const routeConfig = (await getRoute(absolutePath, this.options)) as PageMetaDatum;
        return routeConfig;
    }

    setHomePage(result: PageMetaDatum[]) {
        const hasHome = result.some(page => {
            if (page.home) return true;
            // Exclusion of subcontracting
            const base = page.path.split('/')[0];
            if (this.options.subPackages.includes(`src/${base}`)) return true;

            return false;
        });

        if (hasHome) return true;

        const isFoundHome = result.some(item => {
            if (this.options.homePage.includes(item.path)) {
                item.home = true;
                return true;
            } else {
                return false;
            }
        });

        if (isFoundHome) return true;
        this.logger?.warn(
            'No home page found, check the configuration of pages.config.ts, or add the `homePage` option to UniPages in vite.config.js, or add `type="home"` to the routeBlock of your vue page.',
            {
                timestamp: true,
            },
        );
    }

    async mergePageMetaData() {
        const pageMetaData = await this.parsePages(this.pagesPath, this.pagesGlobConfig?.pages);
        this.pageMetaData = pageMetaData;
        debug.pages(this.pageMetaData);
    }

    async subParsePages(pages: PagePath[], overrides?: PageMetaDatum[]) {
        const generatedPageMetaData = await Promise.all(pages.map(async page => await this.parsePage(page)));
        const _generatedPageMetaData = generatedPageMetaData.map(item => item.pages).flat();
        const customPagesMetahData = overrides || [];
        const result = customPagesMetahData.length ? mergePageMetaDataArray(_generatedPageMetaData.concat(customPagesMetahData)) : _generatedPageMetaData;
        return result;
    }

    async mergeSubPageMetaData() {
        const subPageMaps: Record<string, PageMetaDatum[]> = {};
        const subPackages = this.pagesGlobConfig?.subPackages || [];

        for (const [dir, pages] of Object.entries(this.subPagesPath)) {
            const _root = path.basename(dir);
            const root = slash(path.join(this.options.subRootPrefix, _root));
            const globPackage = subPackages?.find(v => v.root === root);
            subPageMaps[root] = await this.subParsePages(pages, globPackage?.pages);
            // subPageMaps[root] = subPageMaps[root].map(page => ({ ...page, path: slash(path.relative(root, page.path)) }));
            // console.log(subPageMaps);
        }

        // Inherit subPackages that do not exist in the config
        for (const { root, pages } of subPackages) {
            if (root && !subPageMaps[root]) subPageMaps[root] = pages || [];
        }

        const subPageMetaData = Object.keys(subPageMaps).map(root => ({ root, pages: subPageMaps[root] }));

        this.subPageMetaData = subPageMetaData;
        debug.subPages(this.subPageMetaData);
    }

    async scanPages() {
        const pageDirFiles = this.options.dirs.map(dir => {
            return { dir, files: getPagePaths(dir, this.options) };
        });

        this.pagesPath = pageDirFiles.map(page => page.files).flat();
        debug.pages(this.pagesPath);
    }

    async scanSubPages() {
        const subPagesPath: Record<string, PagePath[]> = {};
        for (const dir of this.options.subPackages) {
            const pagePaths = getPagePaths(dir, this.options);
            subPagesPath[dir] = pagePaths;
        }
        this.subPagesPath = subPagesPath;
        debug.subPages(this.subPagesPath);
    }

    async updatePagesJSON() {
        checkPagesJsonFile(this.resolvedPagesJSONPath);
        this.options.onBeforeLoadUserConfig(this);
        await this.loadUserPagesConfig();
        this.options.onAfterLoadUserConfig(this);

        if (this.options.mergePages) {
            this.options.onBeforeScanPages(this);
            await this.scanPages();
            await this.scanSubPages();
            this.options.onAfterScanPages(this);
        }

        this.options.onBeforeMergePageMetaData(this);
        await this.mergePageMetaData();
        await this.mergeSubPageMetaData();
        this.options.onAfterMergePageMetaData(this);
        this.options.onBeforeWriteFile(this);

        const data = {
            ...this.pagesGlobConfig,
            pages: this.pageMetaData,
            subPackages: this.subPageMetaData,
        };
        const pagesJson = JSON.stringify(data, null, this.options?.minify ? undefined : 2);
        writeFileSync(this.resolvedPagesJSONPath, pagesJson);

        this.options.onAfterWriteFile(this);
    }

    setLogger(logger: Logger) {
        this.logger = logger;
    }
}

function getPagePaths(dir: string, options: ResolvedOptions) {
    const pagesDirPath = slash(path.resolve(options.root, dir));
    const basePath = slash(path.join(options.root, options.outDir));
    const files = getPageFiles(pagesDirPath, options);
    debug.pages(dir, files);
    const pagePaths = files
        .map(file => slash(file))
        .map(file => ({
            relativePath: path.relative(basePath, slash(path.resolve(pagesDirPath, file))),
            absolutePath: slash(path.resolve(pagesDirPath, file)),
        }));

    return pagePaths;
}
