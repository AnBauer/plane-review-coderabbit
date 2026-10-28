/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
// hooks
import { useCycleFilter } from "@/hooks/store/use-cycle-filter";

type Props = {
  projectId: string;
};

export function CycleFiltersSavedIndicator(props: Props) {
  const { projectId } = props;
  // hooks
  const { isProjectFilterSaved } = useCycleFilter();
  const { t } = useTranslation();

  if (!isProjectFilterSaved(projectId)) return null;

  return <span className="text-11 whitespace-nowrap text-tertiary">{t("project_cycles.filters_saved")}</span>;
}
