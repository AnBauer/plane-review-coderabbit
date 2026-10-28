/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { z } from "zod";
// plane imports
import { MODULE_STATUS } from "@plane/constants";
import type { TModuleStatus } from "@plane/types";

const MODULE_STATUS_VALUES = new Set<string>(MODULE_STATUS.map((status) => status.value));

const isModuleStatus = (value: unknown): value is TModuleStatus =>
  typeof value === "string" && MODULE_STATUS_VALUES.has(value);

/**
 * Schema of the module status filters saved in the local storage. Unknown statuses are dropped.
 */
export const StoredModuleStatusFiltersSchema = z
  .array(z.unknown())
  .transform((values) => values.filter(isModuleStatus));

/**
 * Reads saved module status filters, returning an empty list when the value is not a list.
 */
export const parseStoredModuleStatuses = (value: unknown): TModuleStatus[] => {
  const result = StoredModuleStatusFiltersSchema.safeParse(value);
  return result.success ? result.data : [];
};
