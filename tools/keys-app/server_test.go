package main

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"
)

func req(t *testing.T, raw string) string {
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write([]byte(raw))
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	var b strings.Builder
	r := bufio.NewReader(c)
	for {
		l, err := r.ReadString('\n')
		b.WriteString(l)
		if err != nil {
			break
		}
	}
	return b.String()
}

func TestServer(t *testing.T) {
	var got [][]string
	sendKeys = func(k []string) error { got = append(got, k); return nil }
	if !serve(fmt.Sprintf("127.0.0.1:%d", port)) {
		t.Fatal("listen")
	}
	if r := req(t, "GET /ping HTTP/1.1\r\nHost: x\r\n\r\n"); !strings.Contains(r, `"ok":true`) {
		t.Fatal(r)
	}
	body := `{"keys":["shift+3","ctrl+alt+shift+7"]}`
	if r := req(t, fmt.Sprintf("POST /keys HTTP/1.1\r\nContent-Length: %d\r\n\r\n%s", len(body), body)); !strings.Contains(r, "403") {
		t.Fatal("без заголовка должно быть 403: " + r)
	}
	if r := req(t, fmt.Sprintf("POST /keys HTTP/1.1\r\nX-Premiere-Assistant: 1\r\nContent-Length: %d\r\n\r\n%s", len(body), body)); !strings.Contains(r, `"ok":true`) {
		t.Fatal(r)
	}
	bad := `{"keys":["ctrl+alt+delete"]}`
	if r := req(t, fmt.Sprintf("POST /keys HTTP/1.1\r\nX-Premiere-Assistant: 1\r\nContent-Length: %d\r\n\r\n%s", len(bad), bad)); !strings.Contains(r, "400") {
		t.Fatal("запрещённая комбинация: " + r)
	}
	if !allow["ctrl+alt+shift+q"] || allow["ctrl+alt+shift+f1"] {
		t.Fatal("набор клавиш не совпадает с core")
	}
	quit := make(chan bool, 1)
	onQuit = func() { quit <- true }
	if r := req(t, "POST /quit HTTP/1.1\r\nX-Premiere-Assistant: 1\r\nContent-Length: 0\r\n\r\n"); !strings.Contains(r, `"ok":true`) {
		t.Fatal(r)
	}
	select {
	case <-quit:
	case <-time.After(time.Second):
		t.Fatal("quit не вызван")
	}
	if len(got) != 1 || got[0][1] != "ctrl+alt+shift+7" {
		t.Fatalf("нажатия: %v", got)
	}
}
