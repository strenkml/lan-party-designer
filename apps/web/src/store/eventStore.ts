import { EventDoc } from "@lpd/shared";
import { createDocStore } from "./docStore";

export const useEventDoc = createDocStore<EventDoc>(EventDoc.parse({}));
