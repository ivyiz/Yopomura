import type { z } from "zod";
import { setValueFromDeepObject } from "./objectPath";

type ZodSchema = z.ZodTypeAny;

/**
 * Repeatedly applies Zod issue paths by filling values from `getDefaultValue` until the schema parses or passes exhaust.
 * Same pattern as `parseAppSettings`: fill missing/invalid leaves from a defaults tree (or dynamic resolver).
 */
export const repairZodInputWithDefaults = <T extends ZodSchema>(
    schema: T,
    input: unknown,
    getDefaultValue: (path: (string | number)[], context: Record<string, unknown>) => unknown,
    maxPasses = 5,
): { success: true; data: z.infer<T> } | { success: false } => {
    let current: Record<string, unknown> =
        typeof input === "object" && input !== null && !Array.isArray(input) ? { ...(input as object) } : {};
    for (let pass = 0; pass < maxPasses; pass++) {
        const r = schema.safeParse(current);
        if (r.success) return { success: true, data: r.data };
        const fixed = { ...current };
        const issues = [...r.error.issues].sort((a, b) => a.path.length - b.path.length);
        for (const e of issues) {
            const path = e.path as (string | number)[];
            const def = getDefaultValue(path, fixed);
            if (def !== undefined) setValueFromDeepObject(fixed, path, def);
        }
        current = fixed;
    }
    return { success: false };
};
