package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeChatSessionCommands(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("MULTICA_AGENT_ID", "")
	t.Setenv("MULTICA_TASK_ID", "")
	t.Setenv("MULTICA_DAEMON_PORT", "")
	const id = "11111111-1111-4111-8111-111111111111"
	var method, path string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.RequestURI()
		if r.Header.Get("X-Workspace-ID") != "ws-1" || r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing scoped credentials")
		}
		body = nil
		if r.Method == http.MethodPost {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/messages") && r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`[{"role":"assistant","task_id":"task-1","content":"answer"}]`))
		} else {
			_, _ = w.Write([]byte(`{"id":"session-1","message_id":"message-1","task_id":"task-1"}`))
		}
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)
	if err := os.WriteFile("message.md", []byte("中文第一行\n$(echo literal) `literal`\\n\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                  string
		args                  []string
		method, path, content string
	}{
		{"create", []string{"create", "--agent-id", id, "--project", id, "--title", "飞书文档"}, "POST", "/api/chat/sessions", ""},
		{"list", []string{"list"}, "GET", "/api/chat/sessions?status=all", ""},
		{"get", []string{"get", id}, "GET", "/api/chat/sessions/" + id, ""},
		{"send file", []string{"send", id, "--content-file", "message.md"}, "POST", "/api/chat/sessions/" + id + "/messages", "中文第一行\n$(echo literal) `literal`\\n"},
		{"messages", []string{"messages", id}, "GET", "/api/chat/sessions/" + id + "/messages", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cmd := newChatSessionCmd()
			cmd.SetArgs(tc.args)
			out, err := captureStdout(t, cmd.Execute)
			if err != nil {
				t.Fatal(err)
			}
			if method != tc.method || path != tc.path {
				t.Fatalf("request = %s %s", method, path)
			}
			if !json.Valid([]byte(out)) {
				t.Fatalf("invalid JSON: %s", out)
			}
			if tc.content != "" && body["content"] != tc.content {
				t.Fatalf("content = %q", body["content"])
			}
			if tc.name == "create" && (body["agent_id"] != id || body["project_id"] != id || body["title"] != "飞书文档") {
				t.Fatalf("body = %#v", body)
			}
		})
	}
}

func TestNativeChatRejectsInvalidInputBeforeRequest(t *testing.T) {
	t.Chdir(t.TempDir())
	outside := filepath.Join(t.TempDir(), "private.md")
	if err := os.WriteFile(outside, []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	const id = "11111111-1111-4111-8111-111111111111"
	for _, args := range [][]string{
		{"create"}, {"create", "--agent-id", id, "--project", "bad"}, {"get", "../other"},
		{"send", id}, {"send", id, "--content", "   "},
		{"send", id, "--content", "hello", "--content-file", outside},
		{"send", id, "--content-file", outside},
	} {
		cmd := newChatSessionCmd()
		cmd.SilenceUsage = true
		cmd.SilenceErrors = true
		cmd.SetArgs(args)
		if err := cmd.Execute(); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}
