import * as Comlink from "comlink";
import type * as vf from "../../logic/vineflower/vineflower";
import { DecompileJar, type DecompileResult } from "./types";
import type { Jar } from "../../utils/Jar";
import type { DecompileWorker } from "./worker";
import { DEFAULT_VERSION, type Version } from "../../logic/vineflower/versions";
import { toClassFilePath, type ClassName } from "../../utils/Names";
import { decompileVersion, readSource, isVersionCached } from "../../logic/SourceCache";
import { tokenize } from "../../logic/JavaTokenizer";

function createWorker() {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "decompiler" });
    return Comlink.wrap<DecompileWorker>(worker);
}
type WorkerInstance = ReturnType<typeof createWorker>;

const MAX_THREADS = navigator.hardwareConcurrency || 4;
let workers: WorkerInstance[] = [];
let preferWasmRuntime = true;
let version: Version = DEFAULT_VERSION;

async function ensureWorkers(count: number) {
    count = Math.min(count, MAX_THREADS);
    if (workers.length >= count) return;

    let newWorkers = Array.from(
        { length: count - workers.length },
        () => createWorker());

    await Promise.all(newWorkers.map(w => w.loadVFRuntime(preferWasmRuntime, version)));
    workers.push(...newWorkers);
}

async function findWorker(): Promise<WorkerInstance> {
    let i = 0;
    if (workers.length > 0) {
        const count = await Promise.all(workers.map(w => w.promiseCount()));
        i = workers.reduce((a, _, b) => count[a] < count[b] ? a : b, 0);
        if (count[i] === 0) return workers[i];
    }

    if (workers.length < (MAX_THREADS - 1)) {
        i = workers.length;
        await ensureWorkers(workers.length + 1);
    }

    return workers[i];
}

export async function setRuntime(preferWasm: boolean) {
    preferWasmRuntime = preferWasm;
    await Promise.all(workers.map(w => w.scheduleClose()));
    workers = [];
}

async function setVersion(newVersion: Version) {
    if (version === newVersion) return;
    version = newVersion;
    await Promise.all(workers.map(w => w.scheduleClose()));
    workers = [];
}

export async function setOptions(options: vf.Options) {
    const sab = new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT);
    const state = new Uint32Array(sab);
    state[0] = 0;

    await Promise.all(workers.map(w => w.setOptions(options, sab)));
}

export async function deleteCache(): Promise<number> {
    const worker = await findWorker();
    return await worker.clear();
}

export type DecompileEntireJarOptions = {
    threads?: number,
    splits?: number,
    logger?: (className: string, current: number, total: number) => void,
};

export type DecompileEntireJarTask = {
    start: () => Promise<number>,
    stop: () => void;
};

export function decompileEntireJar(jar: Jar, _version: Version, options?: DecompileEntireJarOptions): DecompileEntireJarTask {
    return {
        async start() {
            options?.logger?.("Decompiling...", 0, 1);
            await decompileVersion(jar.name);
            options?.logger?.("Done", 1, 1);
            return 1;
        },
        stop() {
            // TODO: cancellation support
        },
    };
}

export async function decompileClass(className: ClassName, jar: Jar, version: Version): Promise<DecompileResult> {
    const versionString = jar.name;

    const allClasses: ClassName[] = Object.keys(jar.entries)
        .filter(p => p.endsWith('.class'))
        .map(p => p.slice(0, -6) as ClassName); // حذف .class
        
    // ۱. سعی کن از cache بخون
    try {
        const source = await readSource(versionString, className);
        return {
            className,
            checksum: 0,
            jarName: jar.name,
            source,
            tokens: tokenize(source, className, allClasses),
            language: "java",
            version,
        };
    } catch {
        // cache نیست، برو سراغ decompile
    }

    // ۲. decompile کن
    try {
        await decompileVersion(versionString);
    } catch (err) {
        const isCancelled = err instanceof Error && err.message === "CANCELLED";
        return {
            className,
            checksum: 0,
            jarName: jar.name,
            source: isCancelled
                ? `// Decompilation cancelled for ${versionString}`
                : `// Failed to decompile ${versionString}: ${err}`,
            tokens: [],
            language: "java",
            version,
        };
    }

    // ۳. دوباره از cache بخون
    try {
        const source = await readSource(versionString, className);
        return {
            className,
            checksum: 0,
            jarName: jar.name,
            source,
            tokens: tokenize(source, className, allClasses),
            language: "java",
            version,
        };
    } catch (err) {
        return {
            className,
            checksum: 0,
            jarName: jar.name,
            source: `// Source not found for ${className}\n// ${err}`,
            tokens: [],
            language: "java",
            version,
        };
    }
}

export async function getClassBytecode(className: ClassName, jar: Jar): Promise<DecompileResult> {
    const entry = jar.entries[toClassFilePath(className)];

    if (!entry) return {
        className,
        checksum: 0,
        jarName: jar.name,
        source: `// Class not found: ${className}`,
        tokens: [],
        language: "bytecode",
        version,
    };

    const classData: ArrayBufferLike[] = [];
    const data = await entry.bytes();
    classData.push(data.buffer);

    const jarClasses = new DecompileJar(jar).classes;
    for (const classFile of jarClasses) {
        if (!classFile.startsWith(`${className}\$`)) {
            continue;
        }

        const data = await jar.entries[toClassFilePath(classFile)]!.bytes();
        classData.push(data.buffer);
    }

    const worker = await findWorker();
    return await worker.getClassBytecode(className, entry.crc32, jar.name, classData);
}