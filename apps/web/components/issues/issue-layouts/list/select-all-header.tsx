/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { useTranslation } from "@plane/i18n";
// hooks
import type { TSelectionHelper } from "@/hooks/use-multiple-select";

type Props = {
  selectionHelpers: TSelectionHelper;
};

/** Header row of the list layout with a checkbox that selects all work items currently shown. */
export const ListSelectAllHeader = observer(function ListSelectAllHeader(props: Props) {
  const { selectionHelpers } = props;
  // translation
  const { t } = useTranslation();
  // derived values
  const selectionStatus = selectionHelpers.isAllSelected();

  if (selectionHelpers.isSelectionDisabled) return null;

  return (
    <label className="flex flex-shrink-0 cursor-pointer items-center gap-2 border-b border-subtle bg-surface-1 px-3 py-1.5 text-body-xs-medium text-secondary">
      <Checkbox
        checked={selectionStatus === "complete"}
        indeterminate={selectionStatus === "partial"}
        aria-label={t("bulk_operations.select_all")}
        onCheckedChange={selectionHelpers.handleSelectAllClick}
      />
      {t("bulk_operations.select_all")}
    </label>
  );
});
