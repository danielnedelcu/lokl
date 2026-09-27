import type { Tables } from "./database";
import type { CATEGORY_KINDS, SERVICE_AREA_KINDS } from "./forms";

// Generated row types, with `kind` narrowed to the values its check
// constraint allows (the generator types a text + check column as string).
export type Category = Omit<Tables<"categories">, "kind"> & { kind: (typeof CATEGORY_KINDS)[number] };
export type ServiceArea = Omit<Tables<"service_areas">, "kind"> & { kind: (typeof SERVICE_AREA_KINDS)[number] };
