package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/testutil"
)

// TestGetIssueQuickCreateOriginalInput locks the product invariant that the
// user's request remains available even when the quick-create agent wrote a
// semantically different description. The detail endpoint derives the raw
// request from the immutable origin task; list/event payloads stay unchanged.
func TestGetIssueQuickCreateOriginalInput(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "quick-create-original-input", nil)
	original := "调查 `command code` 的周限。\n不要改成 Claude Code。\n[@Eve](mention://agent/agent-1)"
	contextJSON, err := json.Marshal(service.QuickCreateContext{
		Type:        service.QuickCreateContextType,
		Prompt:      original,
		RequesterID: testUserID,
		WorkspaceID: testWorkspaceID,
	})
	if err != nil {
		t.Fatalf("marshal quick-create context: %v", err)
	}
	taskID := dbfx.Task(t, agentID, testutil.Cols{
		"runtime_id": handlerTestRuntimeID(t),
		"status":     "completed",
		"context":    contextJSON,
	})
	issueID := dbfx.Issue(t, "Investigate Claude Code weekly limit", testutil.Cols{
		"description":  "Investigate whether the Claude Code weekly limit affects chat processing.",
		"creator_type": "agent",
		"creator_id":   agentID,
		"origin_type":  service.QuickCreateContextType,
		"origin_id":    taskID,
	})
	recorder := testutil.Call(t, testHandler.GetIssue,
		withURLParam(newRequest("GET", "/api/issues/"+issueID, nil), "id", issueID),
	).Want(http.StatusOK)
	var got IssueResponse
	if err := json.NewDecoder(recorder.Body).Decode(&got); err != nil {
		t.Fatalf("decode issue detail: %v", err)
	}
	if got.OriginalInput == nil || *got.OriginalInput != original {
		t.Fatalf("original_input = %v, want exact quick-create prompt %q", got.OriginalInput, original)
	}
	if got.Description == nil || *got.Description != "Investigate whether the Claude Code weekly limit affects chat processing." {
		t.Fatalf("description = %v, want generated summary to remain separate", got.Description)
	}
}

// A quick-create origin is an execution contract, not optional decoration.
// If its context is corrupt, returning only the generated summary would let an
// agent execute the exact lossy representation this endpoint is meant to fix.
func TestGetIssueQuickCreateOriginalInputFailsClosed(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "quick-create-original-input-corrupt", nil)
	taskID := dbfx.Task(t, agentID, testutil.Cols{
		"runtime_id": handlerTestRuntimeID(t),
		"status":     "completed",
		"context":    []byte(`{"type":"quick_create","prompt":"","workspace_id":"` + testWorkspaceID + `"}`),
	})
	issueID := dbfx.Issue(t, "Quick-create issue with corrupt provenance", testutil.Cols{
		"creator_type": "agent",
		"creator_id":   agentID,
		"origin_type":  service.QuickCreateContextType,
		"origin_id":    taskID,
	})

	testutil.Call(t, testHandler.GetIssue,
		withURLParam(newRequest("GET", "/api/issues/"+issueID, nil), "id", issueID),
	).Want(http.StatusInternalServerError)
}
