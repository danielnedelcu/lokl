import type { TypedSchema, TypedSchemaError } from "vee-validate";
import type { z } from "zod";

// Lets vee-validate validate with a zod 4 schema. @vee-validate/zod only
// supports zod 3, and vee-validate 4.15 can't take zod 4's Standard Schema
// directly. Replace with the official adapter once one supports zod 4.
export function zodSchema<S extends z.ZodType>(schema: S): TypedSchema<z.input<S>, z.output<S>> {
  return {
    __type: "VVTypedSchema",
    async parse(values) {
      const result = await schema.safeParseAsync(values);
      if (result.success) return { value: result.data, errors: [] };

      const byPath = new Map<string, string[]>();
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        byPath.set(path, [...(byPath.get(path) ?? []), issue.message]);
      }
      const errors: TypedSchemaError[] = [...byPath].map(([path, messages]) => ({ path, errors: messages }));
      return { errors };
    },
  };
}
