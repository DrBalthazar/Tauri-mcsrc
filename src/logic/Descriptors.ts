// src/logic/Descriptors.ts
import type { ClassName } from "../utils/Names";

const PRIMITIVE_DESCRIPTORS: Record<string, string> = {
    'void': 'V',
    'boolean': 'Z',
    'byte': 'B',
    'char': 'C',
    'short': 'S',
    'int': 'I',
    'long': 'J',
    'float': 'F',
    'double': 'D',
};

/**
 * نگاشت ساده‌ی انواع اولیه و کلاس‌ها
 */
export interface TypeContext {
    /** پکیج فعلی مثل "net.minecraft.client" */
    packageName: string;
    /** نگاشت simple name → FQN (مثل "Minecraft" → "net/minecraft/client/Minecraft") */
    imports: Map<string, string>;
    /** نام کامل کلاس فعلی مثل "net/minecraft/client/MinecraftClient" */
    currentClassName: ClassName;
}

/**
 * تبدیل یک تایپ جاوا به descriptor JVM.
 *
 * مثال‌ها:
 *   int → I
 *   void → V
 *   String → Ljava/lang/String;
 *   Foo[] → [Lnet/minecraft/Foo;
 *   int[] → [I
 *   List<Foo> → Ljava/util/List;
 *   Foo... → [Lnet/minecraft/Foo;
 */
export function typeToDescriptor(type: string, ctx: TypeContext): string {
    let t = type.trim().replace(/\s+/g, '');
    if (!t) return 'V';

    // varargs
    if (t.endsWith('...')) {
        t = t.slice(0, -3) + '[]';
    }

    // آرایه‌ها
    let dimensions = 0;
    while (t.endsWith('[]')) {
        dimensions++;
        t = t.slice(0, -2);
    }

    // حذف generics: List<Foo> → List
    const genericIdx = t.indexOf('<');
    if (genericIdx >= 0) t = t.slice(0, genericIdx);

    // t الان یا primitive است یا نام کلاس
    let baseDesc: string;

    if (PRIMITIVE_DESCRIPTORS[t]) {
        baseDesc = PRIMITIVE_DESCRIPTORS[t];
    } else {
        // Resolve کردن simple name به FQN
        let fqn = t;

        // اگه نقطه نداره، سعی کن با imports حلش کنی
        if (!fqn.includes('/') && !fqn.includes('.')) {
            const imported = ctx.imports.get(fqn);
            if (imported) {
                fqn = imported;
            } else if (fqn === ctx.currentClassName.split('/').pop()) {
                fqn = ctx.currentClassName;
            } else if (ctx.packageName) {
                // فرض کن از همون پکیج میاد
                fqn = ctx.packageName.replace(/\./g, '/') + '/' + fqn;
            }
        }

        fqn = fqn.replace(/\./g, '/');
        baseDesc = `L${fqn};`;
    }

    return '['.repeat(dimensions) + baseDesc;
}

/**
 * تبدیل لیست پارامترها به descriptor متد.
 *
 * مثال:
 *   "(int x, String y)" → "(ILjava/lang/String;)V"
 *   "" → "()V"
 */
export function paramsToDescriptor(
    params: string,
    returnType: string,
    ctx: TypeContext,
): string {
    const returnDesc = typeToDescriptor(returnType, ctx);

    if (!params.trim()) return `()${returnDesc}`;

    // تقسیم بر اساس کاما در سطح بالا (توجه به generics)
    const parts = splitParams(params);

    const paramDescs = parts.map(part => {
        // حذف modifier ها مثل final
        let p = part.trim().replace(/^final\s+/, '');
        if (!p) return '';

        // آخرین identifier معمولاً نام پارامتره، بقیه تایپه
        // تایپ می‌تونه خودش identifier داشته باشه (Foo)
        // پس از آخرین فاصله جدا می‌کنیم
        const lastSpace = p.lastIndexOf(' ');
        let typeStr: string;
        if (lastSpace === -1) {
            // فقط تایپ داریم (نادر در جاوا)
            typeStr = p;
        } else {
            typeStr = p.slice(0, lastSpace).trim();
        }

        return typeToDescriptor(typeStr, ctx);
    }).filter(Boolean);

    return `(${paramDescs.join('')})${returnDesc}`;
}

/**
 * تقسیم پارامترهای یک متد با توجه به generics
 */
function splitParams(params: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of params) {
        if (ch === '<' || ch === '(') depth++;
        else if (ch === '>' || ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            result.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) result.push(current);
    return result;
}