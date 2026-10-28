/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// plane imports
import { MODULE_STATUS } from "@plane/constants";
import type { TModuleStatus } from "@plane/types";
// local imports
import { useQueryParams } from "./use-query-params";

export const MODULE_STATUS_SEARCH_PARAM = "status";

/**
 * Parses a comma-separated list of module statuses, keeping the known ones in their given order.
 */
export const parseModuleStatuses = (value: string | null | undefined): TModuleStatus[] => {
  if (!value) return [];
  const knownStatuses = new Set(MODULE_STATUS.map((status) => status.value));
  return value
    .split(",")
    .filter((status): status is TModuleStatus => knownStatuses.has(status as TModuleStatus));
};

/**
 * Keeps the quick status filter of the modules list in the URL.
 * @param initialStatuses comma-separated statuses that are written to the URL when defined
 */
export const useModuleStatusFilter = (initialStatuses?: string) => {
  // router
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updateQueryParams } = useQueryParams();
  // derived values
  const statusParam = searchParams.get(MODULE_STATUS_SEARCH_PARAM);
  const activeStatuses = useMemo(() => parseModuleStatuses(statusParam), [statusParam]);

  const updateStatuses = useCallback(
    (statuses: TModuleStatus[]) => {
      router.replace(
        statuses.length > 0
          ? updateQueryParams({ paramsToAdd: { [MODULE_STATUS_SEARCH_PARAM]: statuses.join(",") } })
          : updateQueryParams({ paramsToRemove: [MODULE_STATUS_SEARCH_PARAM] })
      );
    },
    [router, updateQueryParams]
  );

  const switchStatus = useCallback(
    (status: TModuleStatus) => {
      updateStatuses(
        activeStatuses.includes(status) ? activeStatuses.filter((s) => s !== status) : [...activeStatuses, status]
      );
    },
    [activeStatuses, updateStatuses]
  );

  useEffect(() => {
    if (initialStatuses === undefined) return;
    updateStatuses(parseModuleStatuses(initialStatuses));
    // only re-apply when the initial statuses change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatuses]);

  return { activeStatuses, switchStatus };
};
