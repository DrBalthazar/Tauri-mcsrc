// src/logic/SourceExporter.ts
import { BehaviorSubject } from "rxjs";
import { invoke } from "@tauri-apps/api/core";
import { decompileVersion, isVersionCached } from "./SourceCache";

export type SourceExportStatus = 'idle' | 'decompiling' | 'copying' | 'done' | 'cancelled' | 'error';

export interface SourceExportState {
    status: SourceExportStatus;
    version: string;
    message: string;
    error?: string;
}

export const sourceExportState = new BehaviorSubject<SourceExportState | null>(null);

/**
 * Export کامل: از cache به پوشه کاربر
 */
export async function exportVersionSources(
    version: string,
    targetDir: string,
): Promise<{ copied: number; target: string }> {
    try {
        // ۱. اطمینان از cache
        const cached = await isVersionCached(version);
        if (!cached) {
            sourceExportState.next({
                status: 'decompiling',
                version,
                message: `Decompiling ${version}... (first time only)`,
            });
            await decompileVersion(version);
        }

        // ۲. کپی کل cache به پوشه کاربر
        sourceExportState.next({
            status: 'copying',
            version,
            message: `Copying sources to ${targetDir}...`,
        });

        const result = await invoke<{ ok: boolean; copied: number; target: string }>(
            "copy_sources_to",
            { version, target: targetDir },
        );

        sourceExportState.next({
            status: 'done',
            version,
            message: `Done! Copied ${result.copied} entries to ${result.target}`,
        });

        return { copied: result.copied, target: result.target };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sourceExportState.next({
            status: 'error',
            version,
            message: 'Export failed',
            error: message,
        });
        throw err;
    }
}

export function resetSourceExport() {
    sourceExportState.next(null);
}