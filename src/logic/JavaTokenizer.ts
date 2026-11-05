// src/logic/JavaTokenizer.ts
import type { Token, MemberToken } from "./Tokens";
import type { ClassName } from "../utils/Names";
import { paramsToDescriptor, typeToDescriptor, type TypeContext } from "./Descriptors";

const KEYWORDS = new Set([
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
    'char', 'class', 'const', 'continue', 'default', 'do', 'double',
    'else', 'enum', 'extends', 'final', 'finally', 'float', 'for',
    'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface',
    'long', 'native', 'new', 'package', 'private', 'protected', 'public',
    'return', 'short', 'static', 'strictfp', 'super', 'switch',
    'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
    'void', 'volatile', 'while', 'record', 'sealed', 'permits', 'var',
    'true', 'false', 'null',
]);

const MODIFIERS = new Set([
    'public', 'private', 'protected', 'static', 'final', 'abstract',
    'synchronized', 'native', 'transient', 'volatile', 'strictfp',
    'default', 'sealed', 'non-sealed',
]);

interface ClassInfo {
    /** FQN با اسلش: net/minecraft/Foo */
    fqn: ClassName;
    /** simple name: Foo */
    simpleName: string;
}

/**
 * ساخت نگاشت simple name → FQN از لیست کلاس‌ها
 */
function buildClassMap(allClasses: ClassName[]): Map<string, ClassName> {
    const map = new Map<string, ClassName>();
    for (const fqn of allClasses) {
        const simple = fqn.split('/').pop()!;
        // اولویت با اولی هست (کلاس‌های هم‌نام در پکیج‌های مختلف، یکی برنده می‌شه)
        if (!map.has(simple)) map.set(simple, fqn);
        // inner classes
        if (simple.includes('$')) {
            const outerSimple = simple.split('$')[0];
            // این mapping رو بازنویسی نکن
            if (!map.has(outerSimple)) map.set(outerSimple, fqn.split('$')[0] as ClassName);

        }
    }
    return map;
}

/**
 * پارس کردن package و imports از سورس
 */
function parseHeader(source: string): {
    packageName: string;
    imports: Map<string, string>;  // simple → FQN (با اسلش)
} {
    const imports = new Map<string, string>();

    const packageMatch = source.match(/^\s*package\s+([\w.]+)\s*;/m);
    const packageName = packageMatch ? packageMatch[1] : '';

    const importRegex = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
    let m;
    while ((m = importRegex.exec(source)) !== null) {
        const full = m[1];
        if (full.endsWith('.*')) continue; // wildcard، نگه نمی‌داریم
        const simple = full.split('.').pop()!;
        const fqn = full.replace(/\./g, '/');
        imports.set(simple, fqn);
    }

    return { packageName, imports };
}

/**
 * پیدا کردن نام کلاس فعلی از سورس
 * از package + نام کلاس اصلی استفاده می‌کنیم
 */
function findCurrentClassName(source: string, packageName: string): ClassName {
    // اولین کلاس/interface/enum/record بعد از import ها
    const classRegex = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+|sealed\s+|non-sealed\s+)*(class|interface|enum|record|@interface)\s+(\w+)/m;
    const match = source.match(classRegex);
    if (!match) return 'Unknown' as ClassName;

    const simpleName = match[2];
    const pkg = packageName.replace(/\./g, '/');
    return (pkg ? `${pkg}/${simpleName}` : simpleName) as ClassName;
}

/**
 * پیدا کردن مکان و طول یه identifier در source با index
 */
function makeIdentifierToken(
    identifier: string,
    start: number,
    className: ClassName,
    declaration: boolean,
): Token {
    return {
        type: 'class',
        start,
        length: identifier.length,
        className,
        declaration,
    };
}

/**
 * پیدا کردن declaration های متد و فیلد
 */
function findDeclarations(
    source: string,
    classMap: Map<string, ClassName>,
    ctx: TypeContext,
    tokens: Token[],
): void {
    // Regex برای متد: [modifiers] returnType name(params)
    const methodRegex = /(?:^|\n)[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)*([\w$.<>\[\], ?]+)\s+(\w+)\s*\(([^)]*)\)/gm;

    let m: RegExpExecArray | null;
    while ((m = methodRegex.exec(source)) !== null) {
        const returnType = m[1].trim();
        const methodName = m[2];
        const params = m[3];

        // فیلتر: return type نباید keyword باشه
        if (KEYWORDS.has(returnType)) continue;
        // فیلتر: نام متد نباید keyword باشه
        if (KEYWORDS.has(methodName)) continue;

        try {
            const descriptor = paramsToDescriptor(params, returnType, ctx);
            const nameStart = m.index + m[0].lastIndexOf(methodName, m[0].length - params.length - 2);

            const token: MemberToken = {
                type: 'method',
                start: nameStart,
                length: methodName.length,
                className: ctx.currentClassName,
                declaration: true,
                name: methodName,
                descriptor,
            };
            tokens.push(token);
        } catch {
            // skip
        }
    }

    // Regex برای فیلد: [modifiers] type name (= value)?;
    const fieldRegex = /(?:^|\n)[ \t]*(?:(?:public|private|protected|static|final|volatile|transient)\s+)+([\w$.<>\[\], ?]+)\s+(\w+)\s*(?:=[^;]*)?;/gm;

    while ((m = fieldRegex.exec(source)) !== null) {
        const fieldType = m[1].trim();
        const fieldName = m[2];

        if (KEYWORDS.has(fieldType)) continue;
        if (KEYWORDS.has(fieldName)) continue;

        try {
            const descriptor = typeToDescriptor(fieldType, ctx);
            const nameStart = m.index + m[0].indexOf(fieldName, m[0].indexOf(fieldType) + fieldType.length);

            const token: MemberToken = {
                type: 'field',
                start: nameStart,
                length: fieldName.length,
                className: ctx.currentClassName,
                declaration: true,
                name: fieldName,
                descriptor,
            };
            tokens.push(token);
        } catch {
            // skip
        }
    }
}

/**
 * پیدا کردن reference های کلاس در سورس (بدون strings و comments)
 */
function findClassReferences(
    source: string,
    classMap: Map<string, ClassName>,
    tokens: Token[],
): void {
    // State machine: رد شدن از strings و comments
    let i = 0;
    const n = source.length;
    const wordChars = /[A-Za-z0-9_$]/;

    while (i < n) {
        const ch = source[i];

        // خط جدید
        if (ch === '\n') { i++; continue; }

        // کامنت خطی
        if (ch === '/' && source[i + 1] === '/') {
            while (i < n && source[i] !== '\n') i++;
            continue;
        }

        // کامنت بلوکی
        if (ch === '/' && source[i + 1] === '*') {
            i += 2;
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i += 2;
            continue;
        }

        // string
        if (ch === '"') {
            i++;
            while (i < n && source[i] !== '"') {
                if (source[i] === '\\') i++;
                i++;
            }
            i++;
            continue;
        }

        // char
        if (ch === "'") {
            i++;
            while (i < n && source[i] !== "'") {
                if (source[i] === '\\') i++;
                i++;
            }
            i++;
            continue;
        }

        // identifier
        if (wordChars.test(ch) && (i === 0 || !wordChars.test(source[i - 1]))) {
            let j = i;
            while (j < n && wordChars.test(source[j])) j++;
            const word = source.slice(i, j);

            // نادیده گرفتن keyword ها
            if (!KEYWORDS.has(word) && !MODIFIERS.has(word)) {
                // اگه با یه حرف بزرگ شروع می‌شه، احتمالاً کلاسه
                if (/^[A-Z]/.test(word)) {
                    const fqn = classMap.get(word);
                    if (fqn) {
                        tokens.push(makeIdentifierToken(word, i, fqn, false));
                    }
                }
            }

            i = j;
            continue;
        }

        i++;
    }
}

/**
 * Tokenizer اصلی.
 * ورودی: source سورس جاوا، نام کامل کلاس فعلی، لیست همه کلاس‌های موجود
 */
export function tokenize(
    source: string,
    currentClassName: ClassName,
    allClasses: ClassName[],
): Token[] {
    const tokens: Token[] = [];

    // ۱. پارس package و imports
    const { packageName, imports } = parseHeader(source);

    // ۲. ساخت context برای descriptor ها
    const ctx: TypeContext = {
        packageName,
        imports,
        currentClassName,
    };

    // ۳. ساخت نگاشت کلاس‌ها
    const classMap = buildClassMap(allClasses);

    // ۴. پیدا کردن کلاس اصلی
    const detectedClass = findCurrentClassName(source, packageName);
    if (detectedClass !== 'Unknown') {
        ctx.currentClassName = detectedClass;
    }

    // ۵. ثبت خود کلاس به عنوان token
    const simpleName = ctx.currentClassName.split('/').pop()!;
    const classDeclIdx = source.search(new RegExp(`\\b(class|interface|enum|record)\\s+${simpleName}\\b`));
    if (classDeclIdx >= 0) {
        const nameIdx = source.indexOf(simpleName, classDeclIdx);
        tokens.push({
            type: 'class',
            start: nameIdx,
            length: simpleName.length,
            className: ctx.currentClassName,
            declaration: true,
        });
    }

    // ۶. پیدا کردن declaration های متد و فیلد
    findDeclarations(source, classMap, ctx, tokens);

    // ۷. پیدا کردن reference های کلاس
    findClassReferences(source, classMap, tokens);

    // ۸. مرتب‌سازی بر اساس start
    tokens.sort((a, b) => a.start - b.start);

    return tokens;
}