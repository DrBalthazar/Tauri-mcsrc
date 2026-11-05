// src/logic/SourceCache.ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BehaviorSubject } from "rxjs";

export interface DecompileProgress {
    version: string;
    current: number;
    total: number;
    className: string;
    errors: number;
}

export const decompileProgress = new BehaviorSubject<DecompileProgress | null>(null);
export const cachedVersions = new BehaviorSubject<Set<string>>(new Set());

/** نسخه‌هایی که توی این session cache شدن */
const completedVersions = new Set<string>();

/** نسخه‌ای که همین الان در حال decompile هست */
let activeDecompileVersion: string | null = null;

let currentDecompile: Promise<void> | null = null;
let cancelRequested = false;

export async function isVersionCached(version: string): Promise<boolean> {
    try {
        return await invoke<boolean>("is_source_cached", { version });
    } catch (err) {
        console.warn(`[cache] isVersionCached failed for ${version}:`, err);
        return false;
    }
}

export async function decompileVersion(version: string): Promise<void> {
    // ۱. اگه این نسخه توی این session قبلاً cache شده، کاری نکن
    if (completedVersions.has(version)) {
        return;
    }

    // ۲. اگه همین نسخه در حال decompile هست، منتظر همون بمون
    if (currentDecompile && activeDecompileVersion === version) {
        return currentDecompile;
    }

    // ۳. اگه نسخه دیگه‌ای در حال اجراست، صبر کن بعد دوباره چک کن
    if (currentDecompile) {
        await currentDecompile;
        if (completedVersions.has(version)) return;
    }

    // ۴. شروع decompile جدید
    activeDecompileVersion = version;
    cancelRequested = false;

    currentDecompile = (async () => {
        let unlisten: UnlistenFn | null = null;
        try {
            unlisten = await listen<any>("decompile-progress", (event) => {
                const p = event.payload;
                decompileProgress.next({
                    version,
                    current: p.current ?? 0,
                    total: p.total ?? 0,
                    className: p.className ?? "",
                    errors: p.errors ?? 0,
                });
            });

            await invoke("decompile_version", { version });

            // ✅ مهم: علامت بزن که این نسخه cache شده
            completedVersions.add(version);

            const set = new Set(cachedVersions.value);
            set.add(version);
            cachedVersions.next(set);
        } catch (err) {
            if (cancelRequested) {
                console.log(`[cache] Decompile cancelled for ${version}`);
                throw new Error("CANCELLED");
            }
            console.error(`[cache] Decompile failed for ${version}:`, err);
            throw err;
        } finally {
            if (unlisten) unlisten();
            decompileProgress.next(null);
            currentDecompile = null;
            activeDecompileVersion = null;
            cancelRequested = false;
        }
    })();

    return currentDecompile;
}

export async function cancelDecompile(): Promise<void> {
    if (!currentDecompile) return;
    console.log("[cache] Requesting cancel...");
    cancelRequested = true;
    try {
        await invoke("cancel_decompile");
    } catch (err) {
        console.error("[cache] cancel_decompile failed:", err);
    }
}

export async function readSource(version: string, className: string): Promise<string> {
    return await invoke<string>("read_class_source", {
        version,
        className,
    });
}

export async function listCachedVersions(): Promise<string[]> {
    try {
        return await invoke<string[]>("list_cached_versions");
    } catch {
        return [];
    }
}

export async function loadCachedVersionsIntoMemory(): Promise<void> {
    const list = await listCachedVersions();
    cachedVersions.next(new Set(list));
    // نسخه‌های cache‌شده روی دیسک رو توی session علامت بزن
    for (const v of list) {
        completedVersions.add(v);
    }
}