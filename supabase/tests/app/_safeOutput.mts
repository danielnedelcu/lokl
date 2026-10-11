// Loaded before each app test (`tsx --import`, see package.json): the
// test's output, uncaught errors included, has no key fragments
// (installRedactingOutput in @repo/types), as in the apps' servers. Its name
// starts with "_" so it isn't a test itself.
import { installRedactingOutput } from "@repo/types";

installRedactingOutput();
