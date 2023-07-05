import fs from 'fs';
import fg from 'fast-glob';
import * as JSON5 from 'JSON5';
import { extsToGlob } from './utils';
import type { PageMetaDatum, ResolvedOptions } from './types';
import { FILE_EXTENSIONS } from './constant';

export function getPageFiles(path: string, options: ResolvedOptions): string[] {
    const { exclude } = options;

    const ext = extsToGlob(FILE_EXTENSIONS);

    const files = fg.sync(`**/*.${ext}`, {
        ignore: exclude,
        onlyFiles: true,
        cwd: path,
    });

    return files;
}

export function checkPagesJsonFile(path: string) {
    if (!fs.existsSync(path)) {
        writeFileSync(path, JSON.stringify({ pages: [{ path: '' }] }, null, 2));
        return false;
    }
    return true;
}

export function readFileSync(path: string) {
    return fs.readFileSync(path, { encoding: 'utf-8' });
}

export function writeFileSync(path: string, content: string) {
    fs.writeFileSync(path, content, { encoding: 'utf-8' });
}

export async function getRoute(path: string, options: ResolvedOptions): Promise<PageMetaDatum | undefined> {
    const content = readFileSync(path);
    const readRoute = JSON5.parse(content);

    if (!readRoute) return;
    return readRoute;
}
