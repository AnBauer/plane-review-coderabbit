/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
// plane imports
import { MODULE_STATUS } from "@plane/constants";
import { getValueFromLocalStorage, useLocalStorage } from "@plane/hooks";
import type { TModuleStatus } from "@plane/types";
import { parseStoredModuleStatuses } from "@plane/utils";
// local imports
import { useQueryParams } from "./use-query-params";

export const MODULE_STATUS_SEARCH_PARAM = "status";

export const moduleStatusFiltersStorageKey = (projectId: string) => `module_status_filters:${projectId}`;

/**
 * Parses a comma-separated list of module statuses, keeping the known ones in their given order.
 */
export const parseModuleStatuses = (value: string | null | undefined): TModuleStatus[] => {
  if (!value) return [];
  const knownStatuses = new Set(MODULE_STATUS.map((status) => status.value));
  return value.split(",").filter((status): status is TModuleStatus => knownStatuses.has(status as TModuleStatus));
};

const isSameStatusList = (a: TModuleStatus[], b: TModuleStatus[]) =>
  a.length === b.length && a.every((status, index) => status === b[index]);

/**
 * Keeps the quick status filter of the modules list in the URL and remembers it per project.
 * @param initialStatuses comma-separated statuses that are written to the URL when defined
 */
export const useModuleStatusFilter = (initialStatuses?: string) => {
  // router
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projectId } = useParams();
  const { updateQueryParams } = useQueryParams();
  // saved filters
  const storageKey = moduleStatusFiltersStorageKey(projectId?.toString() ?? "");
  const { storedValue, setValue } = useLocalStorage<TModuleStatus[]>(storageKey, []);
  // derived values
  const statusParam = searchParams.get(MODULE_STATUS_SEARCH_PARAM);
  const activeStatuses = useMemo(() => parseModuleStatuses(statusParam), [statusParam]);
  // refs
  const latestStatusesRef = useRef(activeStatuses);

  useEffect(() => {
    latestStatusesRef.current = activeStatuses;
  }, [activeStatuses]);

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

  const saveStatuses = useCallback(
    (statuses: TModuleStatus[]) => {
      try {
        setValue(statuses);
      } catch (error) {
        console.warn("Could not save the module status filters", error);
      }
    },
    [setValue]
  );

  const applyStatuses = useCallback(
    (statuses: TModuleStatus[]) => {
      latestStatusesRef.current = statuses;
      updateStatuses(statuses);
      saveStatuses(statuses);
    },
    [updateStatuses, saveStatuses]
  );

  const switchStatus = useCallback(
    (status: TModuleStatus) => {
      const statuses = latestStatusesRef.current;
      applyStatuses(statuses.includes(status) ? statuses.filter((s) => s !== status) : [...statuses, status]);
    },
    [applyStatuses]
  );

  useEffect(() => {
    if (initialStatuses === undefined) return;
    applyStatuses(parseModuleStatuses(initialStatuses));
    // only re-apply when the initial statuses change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStatuses]);

  useEffect(() => {
    const urlStatuses = parseModuleStatuses(statusParam);
    // wait until the URL shows the latest statuses
    if (!isSameStatusList(urlStatuses, latestStatusesRef.current)) return;

    const savedStatuses = parseStoredModuleStatuses(getValueFromLocalStorage(storageKey, []));
    if (urlStatuses.length > 0) {
      if (!isSameStatusList(urlStatuses, savedStatuses)) saveStatuses(urlStatuses);
      return;
    }
    if (savedStatuses.length > 0) {
      latestStatusesRef.current = savedStatuses;
      updateStatuses(savedStatuses);
      return;
    }
    if (statusParam !== null) updateStatuses([]);
    // sync whenever the URL or the saved filters change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam, storedValue, storageKey]);

  return { activeStatuses, switchStatus };
};
