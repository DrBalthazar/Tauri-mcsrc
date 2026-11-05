// src/utils/LocalJarStorage.ts
import { invoke } from "@tauri-apps/api/core";
import { BehaviorSubject } from "rxjs";

const JAR_DIR_NAME = 'jar_files';

export const currentJarFolderName = new BehaviorSubject<string | null>(JAR_DIR_NAME);

export function isFileSystemAccessSupported(): boolean {
    return true;
}

export async function pickJarDirectory(): Promise<boolean> {
    return true;
}

export async function requestJarDirectoryPermission(): Promise<boolean> {
    return true;
}

export async function forgetJarDirectory(): Promise<void> {
    // no-op
}

export function versionToFilename(version: string): string {
    const safe = version.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    return `${safe}.jar`;
}

export async function tryReadJarFromFolder(version: string): Promise<Blob | null> {
    try {
        const exists = await invoke<boolean>("jar_exists", { version });
        if (!exists) return null;

        const bytes = await invoke<number[]>("read_jar", { version });
        const uint8 = new Uint8Array(bytes);
        const blob = new Blob([uint8], { type: "application/java-archive" });
        console.log(
            `[mcsrc-local] Loaded ${versionToFilename(version)} (${(blob.size / 1024 / 1024).toFixed(1)} MiB)`
        );
        return blob;
    } catch (err) {
        console.warn(`[mcsrc-local] Failed to read ${version}`, err);
        return null;
    }
}

export async function saveJarToFolder(version: string, blob: Blob): Promise<boolean> {
    try {
        const buffer = await blob.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        await invoke("write_jar", { version, bytes });
        console.log(
            `[mcsrc-local] Saved ${versionToFilename(version)} (${(blob.size / 1024 / 1024).toFixed(1)} MiB)`
        );
        return true;
    } catch (err) {
        console.warn(`[mcsrc-local] Failed to save ${version}`, err);
        return false;
    }
}

export async function listJarsInFolder(): Promise<string[]> {
    try {
        const files = await invoke<{ name: string; size: number }[]>("list_jars");
        return files.map((f) => f.name).sort();
    } catch {
        return [];
    }
}

export async function totalJarFolderSize(): Promise<number> {
    try {
        const files = await invoke<{ name: string; size: number }[]>("list_jars");
        return files.reduce((sum, f) => sum + f.size, 0);
    } catch {
        return 0;
    }
}

export async function hasJarInFolder(version: string): Promise<boolean> {
    try {
        return await invoke<boolean>("jar_exists", { version });
    } catch {
        return false;
    }
}

export async function deleteJarFromFolder(version: string): Promise<boolean> {
    return false;
}