package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/util"
)

func init() { chatCmd.AddCommand(newChatSessionCmd()) }

func newChatSessionCmd() *cobra.Command {
	root := &cobra.Command{Use: "session", Short: "Create, read and message native Multica chat sessions"}
	list := &cobra.Command{Use: "list", Args: cobra.NoArgs, Short: "List your native conversations, including archived sessions", RunE: func(cmd *cobra.Command, _ []string) error {
		return chatSessionRequest(cmd, "/api/chat/sessions?status=all", nil)
	}}
	create := &cobra.Command{Use: "create", Args: cobra.NoArgs, Short: "Create a visible native conversation", RunE: runChatSessionCreate}
	create.Flags().String("agent-id", "", "Agent UUID (required)")
	create.Flags().String("project", "", "Project UUID")
	create.Flags().String("title", "", "Conversation title")
	get := &cobra.Command{Use: "get <session-id>", Args: cobra.ExactArgs(1), Short: "Read a native conversation", RunE: runChatSessionGet}
	send := &cobra.Command{Use: "send <session-id>", Args: cobra.ExactArgs(1), Short: "Send a message and return its message/task IDs", RunE: runChatSessionSend}
	send.Flags().String("content", "", "Message text")
	send.Flags().String("content-file", "", "Read UTF-8 text from a file inside the working directory")
	send.Flags().Bool("content-stdin", false, "Read message text from stdin")
	messages := &cobra.Command{Use: "messages <session-id>", Args: cobra.ExactArgs(1), Short: "Read native conversation messages, including task IDs", RunE: runChatSessionMessages}
	for _, c := range []*cobra.Command{list, create, get, send, messages} {
		c.Flags().String("output", "json", "Output format: json")
		root.AddCommand(c)
	}
	return root
}

func chatSessionRequest(cmd *cobra.Command, path string, body any) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()
	var response any
	if body == nil {
		err = client.GetJSON(ctx, path, &response)
	} else {
		err = client.PostJSON(ctx, path, body, &response)
	}
	if err != nil {
		return fmt.Errorf("native chat: %w", err)
	}
	return cli.PrintJSON(os.Stdout, response)
}

func nativeSessionPath(id string) (string, error) {
	if _, err := util.ParseUUID(id); err != nil {
		return "", fmt.Errorf("invalid session UUID: %w", err)
	}
	return "/api/chat/sessions/" + id, nil
}

func runChatSessionCreate(cmd *cobra.Command, _ []string) error {
	agent, _ := cmd.Flags().GetString("agent-id")
	if _, err := util.ParseUUID(agent); err != nil {
		return fmt.Errorf("--agent-id requires a UUID: %w", err)
	}
	title, _ := cmd.Flags().GetString("title")
	project, _ := cmd.Flags().GetString("project")
	body := map[string]any{"agent_id": agent, "title": title}
	if project != "" {
		if _, err := util.ParseUUID(project); err != nil {
			return fmt.Errorf("--project requires a UUID: %w", err)
		}
		body["project_id"] = project
	}
	return chatSessionRequest(cmd, "/api/chat/sessions", body)
}

func runChatSessionGet(cmd *cobra.Command, args []string) error {
	path, err := nativeSessionPath(args[0])
	if err != nil {
		return err
	}
	return chatSessionRequest(cmd, path, nil)
}

func runChatSessionMessages(cmd *cobra.Command, args []string) error {
	path, err := nativeSessionPath(args[0])
	if err != nil {
		return err
	}
	return chatSessionRequest(cmd, path+"/messages", nil)
}

func runChatSessionSend(cmd *cobra.Command, args []string) error {
	path, err := nativeSessionPath(args[0])
	if err != nil {
		return err
	}
	content, present, err := resolveTextFlag(cmd, "content")
	if err != nil {
		return err
	}
	if !present || strings.TrimSpace(content) == "" {
		return fmt.Errorf("non-empty --content, --content-file or --content-stdin is required")
	}
	// A failed request can have committed: callers must reconcile before retrying.
	return chatSessionRequest(cmd, path+"/messages", map[string]any{"content": content})
}
