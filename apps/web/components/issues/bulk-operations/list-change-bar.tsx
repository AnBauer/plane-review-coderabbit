/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssue, TIssuePriorities } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { PrioritySelect } from "@/components/dropdowns/priority/priority-select";
import { StateSelect } from "@/components/dropdowns/state/state-select";
// hooks
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

type Props = {
  className?: string;
  selectionHelpers: TSelectionHelper;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
};

/**
 * Bar shown at the bottom of the list layout while work items are selected. Sets the state or priority of all
 * selected work items through the issue store's `updateIssue`, which applies the change optimistically.
 */
export const IssueListChangeBar = observer(function IssueListChangeBar(props: Props) {
  const { className, selectionHelpers, updateIssue } = props;
  // router
  const { projectId: routerProjectId } = useParams();
  const projectId = routerProjectId?.toString();
  // translation
  const { t } = useTranslation();
  // store hooks
  const { isSelectionActive, selectedEntityIds, applyBulkUpdate } = useMultipleSelectStore();

  if (!isSelectionActive || selectionHelpers.isSelectionDisabled || !projectId || !updateIssue) return null;

  const handleBulkUpdate = async (data: Partial<TIssue>) => {
    const failedIds = await applyBulkUpdate(data, (issueId, issueData) => updateIssue(projectId, issueId, issueData));
    if (failedIds.length > 0)
      setToast({
        type: "error",
        title: t("bulk_operations.update_failed.title"),
        message: t("bulk_operations.update_failed.message", { count: failedIds.length }),
      });
  };

  return (
    <div className={cn("sticky bottom-0 left-0 z-[2] grid h-20 place-items-center px-3.5", className)}>
      <div className="flex items-center gap-3 rounded-lg border border-subtle bg-surface-1 px-4 py-2 shadow-raised-200">
        <span className="text-body-xs-medium text-primary">
          {t("bulk_operations.selected_count", { count: selectedEntityIds.length })}
        </span>
        <StateSelect
          projectId={projectId}
          value={null}
          onChange={(stateId) => handleBulkUpdate({ state_id: stateId })}
          variant="pill-sm"
          tooltip
        />
        <PrioritySelect
          value={null}
          onChange={(priority: TIssuePriorities) => handleBulkUpdate({ priority })}
          variant="pill-sm"
          tooltip
        />
        <Button
          variant="secondary"
          size="sm"
          stretch="auto"
          label={t("bulk_operations.clear_selection")}
          onClick={selectionHelpers.handleClearSelection}
        />
      </div>
    </div>
  );
});
