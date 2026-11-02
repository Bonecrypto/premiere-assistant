// Общая часть (не зависит от Windows): разрешённые клавиши и мини-HTTP. Проверяется тестом на любой ОС.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"
)

const (
	port    = 8766
	version = 8
)

// sendKeys нажимает клавиши (на Windows — winSendKeys).
var sendKeys func(keys []string) error

// onQuit закрывает программу (панель вызывает при обновлении на новую версию).
var onQuit = func() {}

// Метки 0…15 (порядок Premiere) — те же комбинации, что LABEL_KEYS_COMBOS в packages/core/src/protocol.ts.
var allow = map[string]bool{"shift+3": true, "ctrl+k": true, "ctrl+shift+k": true}

func init() {
	for _, k := range []string{"q", "2", "3", "4", "5", "6", "7", "8", "9", "w", "e", "t", "y", "u", "i", "o"} {
		allow["ctrl+alt+shift+"+k] = true
	}
}

// ───────── Мини-HTTP (без net/http — программа остаётся маленькой) ─────────

func reply(c net.Conn, code int, body any) {
	b, _ := json.Marshal(body)
	status := map[int]string{200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error"}[code]
	fmt.Fprintf(c, "HTTP/1.1 %d %s\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", code, status, len(b))
	c.Write(b)
}

var lastRequest = time.Now()

func handle(c net.Conn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(15 * time.Second))
	r := bufio.NewReader(c)
	line, err := r.ReadString('\n')
	if err != nil {
		return
	}
	f := strings.Fields(line)
	if len(f) < 2 {
		return
	}
	method, path := f[0], f[1]
	headers := map[string]string{}
	for {
		h, err := r.ReadString('\n')
		if err != nil {
			return
		}
		h = strings.TrimRight(h, "\r\n")
		if h == "" {
			break
		}
		if i := strings.IndexByte(h, ':'); i > 0 {
			headers[strings.ToLower(strings.TrimSpace(h[:i]))] = strings.TrimSpace(h[i+1:])
		}
	}
	lastRequest = time.Now()
	body := func(maxLen int) ([]byte, bool) {
		n, _ := strconv.Atoi(headers["content-length"])
		if n <= 0 || n > maxLen {
			return nil, false
		}
		b := make([]byte, n)
		if _, err := io.ReadFull(r, b); err != nil {
			return nil, false
		}
		return b, true
	}
	if handleAI(c, method, path, headers, body) {
		return
	}
	switch {
	case method == "GET" && path == "/ping":
		reply(c, 200, map[string]any{"ok": true, "app": "premiere-assistant-keys", "version": version})
	case method == "POST" && path == "/quit":
		if headers["x-premiere-assistant"] != "1" {
			reply(c, 403, map[string]any{"ok": false, "error": "forbidden"})
			return
		}
		reply(c, 200, map[string]any{"ok": true})
		go onQuit()
	case method == "POST" && path == "/keys":
		if headers["x-premiere-assistant"] != "1" {
			reply(c, 403, map[string]any{"ok": false, "error": "forbidden"})
			return
		}
		n, _ := strconv.Atoi(headers["content-length"])
		if n <= 0 || n > 4096 {
			reply(c, 400, map[string]any{"ok": false, "error": "пустой запрос"})
			return
		}
		body := make([]byte, n)
		if _, err := io.ReadFull(r, body); err != nil {
			return
		}
		var req struct {
			Keys []string `json:"keys"`
		}
		if json.Unmarshal(body, &req) != nil || len(req.Keys) < 1 || len(req.Keys) > 8 {
			reply(c, 400, map[string]any{"ok": false, "error": "Неверный список клавиш"})
			return
		}
		for i, k := range req.Keys {
			req.Keys[i] = strings.ToLower(k)
			if !allow[req.Keys[i]] {
				reply(c, 400, map[string]any{"ok": false, "error": "Комбинация не разрешена: " + k})
				return
			}
		}
		if err := sendKeys(req.Keys); err != nil {
			reply(c, 500, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		reply(c, 200, map[string]any{"ok": true})
	default:
		reply(c, 404, map[string]any{"ok": false, "error": "not found"})
	}
}

func serve(addr string) bool {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go handle(c)
		}
	}()
	return true
}
