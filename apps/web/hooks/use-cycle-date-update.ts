/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { setToast } from "@plane/blocks/toast";
import { getDate, renderFormattedPayloadDate } from "@plane/utils";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
// services
import { CycleService } from "@/services/cycle.service";

const cycleService = new CycleService();

type TCycleDateRange = { from: Date | null; to: Date | null };

/**
 * Validates and saves a new date range of a cycle, the same way the cycle modal and the cycle
 * detail sidebar do. Resolves to `true` when the dates were saved.
 */
export const useCycleDateUpdate = (workspaceSlug: string, projectId: string, cycleId: string) => {
  const { t } = useTranslation();
  const { updateCycleDetails } = useCycle();

  return useCallback(
    async (range: TCycleDateRange): Promise<boolean> => {
      const startDate = renderFormattedPayloadDate(range.from) ?? null;
      const endDate = renderFormattedPayloadDate(range.to) ?? null;

      const showError = (message: string) =>
        setToast({ type: "error", title: t("project_cycles.action.update.failed.title"), message });

      // a cycle has either both dates or none (draft)
      if (!!startDate !== !!endDate) {
        showError(t("project_cycles.action.update.error.both_dates_required"));
        return false;
      }

      if (startDate && endDate) {
        // compare calendar days, not instants, so the user's time zone cannot shift the result
        const from = getDate(startDate);
        const to = getDate(endDate);
        if (!from || !to || to < from) {
          showError(t("project_cycles.action.update.error.end_before_start"));
          return false;
        }

        try {
          const res = await cycleService.cycleDateCheck(workspaceSlug, projectId, {
            start_date: startDate,
            end_date: endDate,
            cycle_id: cycleId,
          });
          if (!res.status) {
            showError(t("project_cycles.action.update.error.already_exists"));
            return false;
          }
        } catch {
          showError(t("project_cycles.action.update.failed.description"));
          return false;
        }
      }

      try {
        await updateCycleDetails(workspaceSlug, projectId, cycleId, { start_date: startDate, end_date: endDate });
      } catch {
        showError(t("project_cycles.action.update.failed.description"));
        return false;
      }

      setToast({
        type: "success",
        title: t("project_cycles.action.update.success.title"),
        message: t("project_cycles.action.update.success.description"),
      });
      return true;
    },
    [workspaceSlug, projectId, cycleId, t, updateCycleDetails]
  );
};
