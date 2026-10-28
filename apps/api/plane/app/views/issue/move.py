# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from uuid import UUID

# Django imports
from django.db import connection, models, transaction
from django.utils import timezone

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import (
    CommentReaction,
    CycleIssue,
    FileAsset,
    Issue,
    IssueActivity,
    IssueAssignee,
    IssueComment,
    IssueDescriptionVersion,
    IssueLabel,
    IssueLink,
    IssueMention,
    IssueReaction,
    IssueSequence,
    IssueSubscriber,
    IssueVersion,
    IssueVote,
    Label,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
)
from plane.db.models.issue import IssueAttachment
from plane.utils.uuid import convert_uuid_to_integer

from .. import BaseAPIView

# Models that carry both an ``issue`` foreign key and a denormalised ``project``;
# their rows follow the work item into the target project.
PROJECT_SCOPED_ISSUE_MODELS = [
    IssueAssignee,
    IssueAttachment,
    IssueComment,
    IssueDescriptionVersion,
    IssueLink,
    IssueMention,
    IssueReaction,
    IssueSubscriber,
    IssueVersion,
    IssueVote,
    IssueActivity,
    FileAsset,
]


class IssueMoveEndpoint(BaseAPIView):
    """Move a work item (and its sub-work items) to another project of the workspace."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], creator=True, model=Issue)
    def post(self, request, slug, project_id, pk):
        raw_target_id = request.data.get("target_project_id")
        try:
            target_project_id = UUID(str(raw_target_id))
        except (ValueError, TypeError):
            return Response({"error": "target_project_id must be a valid UUID"}, status=status.HTTP_400_BAD_REQUEST)

        if str(target_project_id) == str(project_id):
            return Response(
                {"error": "The work item already belongs to the target project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_project = Project.objects.filter(
            pk=target_project_id, workspace__slug=slug, archived_at__isnull=True
        ).first()
        if target_project is None:
            return Response({"error": "Target project not found"}, status=status.HTTP_404_NOT_FOUND)

        if not ProjectMember.objects.filter(
            project_id=target_project_id,
            workspace__slug=slug,
            member=request.user,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
        ).exists():
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        source_project = Project.objects.get(pk=project_id, workspace__slug=slug)

        with transaction.atomic():
            root = Issue.objects.select_for_update().filter(workspace__slug=slug, project_id=project_id, pk=pk).first()
            if root is None:
                return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

            # The root first, then its descendants level by level.
            issues = [root]
            frontier = [root.id]
            while frontier:
                children = list(Issue.objects.filter(project_id=project_id, parent_id__in=frontier))
                issues.extend(children)
                frontier = [child.id for child in children]
            issue_ids = [issue.id for issue in issues]

            target_states = list(State.objects.filter(project_id=target_project_id, is_triage=False))
            if not target_states:
                return Response(
                    {"error": "The target project has no states"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            states_by_name = {state.name: state for state in target_states}
            default_state = next((state for state in target_states if state.default), target_states[0])

            labels_by_name = {
                label.name: label.id for label in Label.objects.filter(project_id=target_project_id)
            }

            # Sequence ids come from the target project; serialise with issue creation there.
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [convert_uuid_to_integer(target_project_id)])
            last_sequence = IssueSequence.objects.filter(project_id=target_project_id).aggregate(
                largest=models.Max("sequence")
            )["largest"]
            next_sequence = (last_sequence or 0) + 1

            # Labels of the moved items, resolved before the issue rows are rewritten.
            old_labels = list(IssueLabel.objects.filter(issue_id__in=issue_ids).select_related("label"))

            largest_sort_order = {}
            activities = []
            sequences = []
            for issue in issues:
                old_state_name = issue.state.name if issue.state else None
                issue.state = states_by_name.get(old_state_name, default_state)
                issue.project_id = target_project_id
                issue.sequence_id = next_sequence
                issue.estimate_point = None
                if issue.id == root.id:
                    issue.parent = None

                if issue.state_id not in largest_sort_order:
                    largest_sort_order[issue.state_id] = Issue.objects.filter(
                        project_id=target_project_id, state_id=issue.state_id
                    ).aggregate(largest=models.Max("sort_order"))["largest"]
                largest = largest_sort_order[issue.state_id]
                if largest is not None:
                    issue.sort_order = largest + 10000
                    largest_sort_order[issue.state_id] = issue.sort_order

                issue.save(
                    update_fields=[
                        "state",
                        "project",
                        "sequence_id",
                        "estimate_point",
                        "parent",
                        "sort_order",
                        "completed_at",
                        "updated_at",
                    ]
                )
                sequences.append(
                    IssueSequence(
                        issue=issue,
                        sequence=next_sequence,
                        project_id=target_project_id,
                        workspace_id=issue.workspace_id,
                    )
                )
                activities.append(
                    IssueActivity(
                        issue_id=issue.id,
                        project_id=target_project_id,
                        workspace_id=issue.workspace_id,
                        verb="updated",
                        field="project",
                        old_value=source_project.name,
                        new_value=target_project.name,
                        old_identifier=source_project.id,
                        new_identifier=target_project.id,
                        comment=f"moved the work item from {source_project.name} to {target_project.name}",
                        actor=request.user,
                        epoch=int(timezone.now().timestamp()),
                    )
                )
                next_sequence += 1

            IssueSequence.objects.bulk_create(sequences)

            # Everything that hangs off the work items follows them.
            for model in PROJECT_SCOPED_ISSUE_MODELS:
                model.objects.filter(issue_id__in=issue_ids).update(project_id=target_project_id)
            FileAsset.objects.filter(comment__issue_id__in=issue_ids).update(project_id=target_project_id)
            CommentReaction.objects.filter(comment__issue_id__in=issue_ids).update(project_id=target_project_id)

            # Labels are project specific: map by name, drop the ones the target does not have.
            IssueLabel.objects.filter(issue_id__in=issue_ids).delete()
            IssueLabel.objects.bulk_create(
                [
                    IssueLabel(
                        issue_id=issue_label.issue_id,
                        label_id=labels_by_name[issue_label.label.name],
                        project_id=target_project_id,
                        workspace_id=issue_label.workspace_id,
                    )
                    for issue_label in old_labels
                    if issue_label.label.name in labels_by_name
                ]
            )

            # Cycles and modules belong to the source project.
            CycleIssue.objects.filter(issue_id__in=issue_ids).delete()
            ModuleIssue.objects.filter(issue_id__in=issue_ids).delete()

            IssueActivity.objects.bulk_create(activities)

        return Response(
            {"id": str(root.id), "project_id": str(target_project_id), "sequence_id": root.sequence_id},
            status=status.HTTP_200_OK,
        )
