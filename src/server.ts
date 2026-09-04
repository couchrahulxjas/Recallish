import { createServerEntry } from "@tanstack/react-start/server-entry";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

export default createServerEntry({ fetch: createStartHandler(defaultStreamHandler) });