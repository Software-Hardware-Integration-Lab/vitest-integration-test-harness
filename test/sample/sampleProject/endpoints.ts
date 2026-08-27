/* eslint-disable jsdoc/require-jsdoc */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const defaultDirectory = './number-files';

export async function healthCheck(): Promise<{ 'serviceStatus': 'healthy' | 'unhealthy' }> {
    await new Promise((resolve): void => {
        setTimeout(resolve, 500);
    });

    return { 'serviceStatus': 'healthy' };
}

export async function createNumberFile(num: number, directory = defaultDirectory): Promise<string> {
    const uuid = crypto.randomUUID();

    if (!existsSync(directory)) {
        await mkdir(directory);
    }

    await writeFile(`${ directory }/${ uuid }.txt`, `${ num }`, { 'encoding': 'utf-8' });

    return uuid;
}

export async function addAllNumbersInFiles(directory = defaultDirectory): Promise<number> {
    let sum = 0;

    if (!existsSync(directory)) {
        return Promise.resolve(sum);
    }

    const files = await readdir(directory);

    for (const file of files) {
        const content = await readFile(`${ directory }/${ file }`, { 'encoding': 'utf-8' });

        const num = parseInt(content, 10);

        if (!isNaN(num)) {
            sum += num;
        }
    }

    return Promise.resolve(sum);
}
