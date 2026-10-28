/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { MODULE_STATUS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { ModuleStatusIcon } from "@plane/blocks/icons";
import { PillButton } from "@plane/blocks/pill-button";
// hooks
import { useModuleStatusFilter } from "@/hooks/use-module-status-filter";

export const ModuleStatusFilterChips = observer(function ModuleStatusFilterChips() {
  // plane hooks
  const { t } = useTranslation();
  // url filter
  const { activeStatuses, switchStatus } = useModuleStatusFilter();

  return (
    <div className="flex flex-wrap items-center gap-2 px-page-x py-2">
      {MODULE_STATUS.map((status) => (
        <PillButton
          key={status.value}
          type="button"
          isActive={activeStatuses.includes(status.value)}
          prependIcon={<ModuleStatusIcon status={status.value} />}
          onClick={() => switchStatus(status.value)}
        >
          {t(status.i18n_label)}
        </PillButton>
      ))}
    </div>
  );
});
